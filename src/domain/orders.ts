import type { Order, OrderItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { ShippingError, type ShippingProvider } from "@/integrations/shipping/types";
import { priceCart, type CartIssue, type CartLine, type PricedLine } from "./cart";
import { MAX_CENTS } from "./money";
import { loadVariantRows } from "./cartServer";
import { redeemCoupon, releaseCoupon, validateCoupon } from "./coupons";
import { buildPackages, hasOversizeItem, quotePackages } from "./shipping";
import { getSettings } from "./storeSettings";
import { assertStoreCanSell } from "./subscription";

export class OutOfStockError extends Error {
  name = "OutOfStockError";
  constructor(readonly variantId: string) { super(`Sem estoque: ${variantId}`); }
}
export class CartChangedError extends Error {
  name = "CartChangedError";
  constructor(readonly issues: CartIssue[]) { super("Carrinho alterado"); }
}
export class EmptyCartError extends Error { name = "EmptyCartError"; }
export class AddressInvalidError extends Error { name = "AddressInvalidError"; }
export class ShippingOptionInvalidError extends Error { name = "ShippingOptionInvalidError"; }
export class OversizeItemError extends Error { name = "OversizeItemError"; }
export class OrderNotFoundError extends Error { name = "OrderNotFoundError"; }

export class TotalTooLargeError extends Error { name = "TotalTooLargeError"; }
export class TotalChangedError extends Error {
  name = "TotalChangedError";
  constructor(readonly totalCents: number) { super("Total alterado"); }
}

export type CreateOrderInput = {
  storeId: string; customerId: string; lines: CartLine[]; addressId: string; shippingService: string;
  /** Total que o cliente viu; so comparado (o do servidor sempre vale). Diferente = TotalChangedError antes de baixar estoque. */
  expectedTotalCents?: number;
  /** Chave do cliente por tentativa de checkout: repetir a mesma chave devolve o pedido ja criado (envio duplo). */
  idempotencyKey?: string;
  /** Cupom opcional; validado e consumido no servidor (CouponError se invalido). */
  couponCode?: string;
};
type Db = Parameters<typeof loadVariantRows>[0];

/** Preco/estoque do banco; qualquer issue = CartChangedError (nunca ajusta), vazio = EmptyCartError. */
async function priceOrThrow(db: Db, lines: CartLine[]) {
  const variants = await loadVariantRows(db, lines.map((l) => l.variantId));
  const priced = priceCart(lines, variants);
  if (priced.issues.length > 0) throw new CartChangedError(priced.issues);
  if (priced.lines.length === 0) throw new EmptyCartError("Carrinho vazio");
  return { ...priced, sku: new Map(variants.map((v) => [v.id, v.sku])) };
}
const pricingKey = (lines: PricedLine[]) => JSON.stringify(lines.map((l) => [l.variantId, l.qty, l.unitCents]));

/**
 * Cria o pedido. Nenhum preco/total do navegador entra aqui.
 * 1) Fora de transacao: endereco do cliente, precificacao do banco e cotacao do frete no servidor (rede nao segura conexao).
 * 2) Transacao: reprecifica do banco; mudou algo desde a cotacao (linhas, qtd, preco) = CartChangedError. Baixa o estoque
 *    e grava pedido + snapshots. Sem trava da loja: a baixa e um UPDATE condicional por linha (stock >= qty), atomico no
 *    Postgres; linhas em ordem de variantId, entao pedidos com as mesmas variacoes travam na mesma ordem (sem deadlock).
 * `_testBeforeWrite`: so testes (corrida entre a releitura e a baixa).
 */
export async function createOrder(
  input: CreateOrderInput,
  deps: { provider: ShippingProvider; _testBeforeWrite?: () => Promise<void> },
): Promise<Order & { items: OrderItem[] }> {
  const { storeId, customerId } = input;
  assertStoreCanSell(await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { status: true } }));
  const db = dbForStore(storeId);
  const key = input.idempotencyKey;
  const existing = () => db.order.findFirst({ where: { idempotencyKey: key, customerId }, include: { items: true } });
  if (key) {
    const found = await existing();
    if (found) return found;
  }
  // escopo da loja + dono: endereco de outro cliente ou de outra loja nao casa
  const address = await db.address.findFirst({ where: { id: input.addressId, customerId } });
  if (!address) throw new AddressInvalidError("Endereço inválido");

  const quoted = await priceOrThrow(db, input.lines);
  if (quoted.subtotalCents > MAX_CENTS) throw new TotalTooLargeError("Total acima do limite");
  const dimRows = await db.variant.findMany({
    where: { id: { in: quoted.lines.map((l) => l.variantId) } },
    select: { id: true, product: { select: { weightGrams: true, heightCm: true, widthCm: true, lengthCm: true } } },
  });
  const dims = new Map(dimRows.map((r) => [r.id, r.product]));
  if (hasOversizeItem(quoted.lines, dims)) throw new OversizeItemError("Item fora dos limites de envio");
  const { originCep } = await getSettings(storeId);
  let options;
  try {
    options = await quotePackages(deps.provider, { fromCep: originCep, toCep: address.cep, packages: buildPackages(quoted.lines, dims) });
  } catch (e) {
    throw e instanceof ShippingError ? e : new ShippingError("Falha na cotação", { cause: e });
  }
  const shipping = options.find((o) => o.service === input.shippingService);
  if (!shipping) throw new ShippingOptionInvalidError("Opção de frete indisponível");
  const quotedCoupon = input.couponCode ? await validateCoupon(db, input.couponCode, customerId, quoted.subtotalCents) : null;
  const discountCents = quotedCoupon?.discountCents ?? 0;
  const totalCents = quoted.subtotalCents - discountCents + shipping.priceCents;
  if (totalCents > MAX_CENTS) throw new TotalTooLargeError("Total acima do limite");
  if (input.expectedTotalCents !== undefined && input.expectedTotalCents !== totalCents) throw new TotalChangedError(totalCents);

  // Envio duplo concorrente com a mesma chave: o perdedor falha (unique ou estoque) e devolve o pedido do vencedor.
  return db.$transaction(async (tx) => {
    const fresh = await priceOrThrow(tx, input.lines);
    if (pricingKey(fresh.lines) !== pricingKey(quoted.lines)) throw new CartChangedError([]);
    await deps._testBeforeWrite?.();

    // cupom relido na transacao: mudou desde a cotacao = total novo (cliente confirma) ou erro do cupom
    let coupon = null;
    if (input.couponCode) {
      const v = await validateCoupon(tx, input.couponCode, customerId, fresh.subtotalCents);
      if (v.discountCents !== discountCents) throw new TotalChangedError(fresh.subtotalCents - v.discountCents + shipping.priceCents);
      await redeemCoupon(tx, v.coupon);
      coupon = v.coupon;
    }

    const sorted = [...fresh.lines].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
    for (const l of sorted) {
      const { count } = await tx.variant.updateMany({
        where: { id: l.variantId, active: true, stock: { gte: l.qty }, product: { active: true } },
        data: { stock: { decrement: l.qty } },
      });
      if (count === 0) throw new OutOfStockError(l.variantId); // a transacao inteira volta (inclui baixas anteriores)
    }

    const { cep, street, number, complement, district, city, state } = address;
    const order = await tx.order.create({
      data: {
        storeId, customerId, status: "PENDING_PAYMENT",
        subtotalCents: fresh.subtotalCents, shippingCents: shipping.priceCents, totalCents,
        shippingService: shipping.service, addressSnapshot: { cep, street, number, complement, district, city, state },
        idempotencyKey: key, couponId: coupon?.id, couponCode: coupon?.code, discountCents,
      },
    });
    await tx.orderItem.createMany({
      data: fresh.lines.map((l) => ({
        storeId, orderId: order.id, variantId: l.variantId, productName: l.productName, sku: fresh.sku.get(l.variantId)!,
        color: l.color, size: l.size, unitPriceCents: l.unitCents, quantity: l.qty,
      })),
    });
    return { ...order, items: await tx.orderItem.findMany({ where: { orderId: order.id } }) };
  }).catch(async (e) => {
    const found = key ? await existing() : null;
    if (found) return found;
    throw e;
  });
}

/**
 * Cancela pedido aguardando pagamento e devolve o estoque uma unica vez (idempotente). Outros status: nada muda.
 * `onlyIfPaymentId`: so cancela se esse ainda for o pagamento atual do pedido (mesmo UPDATE condicional, sem corrida).
 * Retorna true so para quem de fato cancelou.
 */
export async function cancelOrder(storeId: string, orderId: string, opts: { onlyIfPaymentId?: string } = {}): Promise<boolean> {
  return dbForStore(storeId).$transaction(async (tx) => {
    const where = { id: orderId, status: "PENDING_PAYMENT" as const, ...(opts.onlyIfPaymentId ? { mpPaymentId: opts.onlyIfPaymentId } : {}) };
    const { count } = await tx.order.updateMany({ where, data: { status: "CANCELED" } });
    if (count === 0) {
      if (!(await tx.order.findFirst({ where: { id: orderId }, select: { id: true } }))) throw new OrderNotFoundError("Pedido não encontrado");
      return false;
    }
    const { couponId } = await tx.order.findFirstOrThrow({ where: { id: orderId }, select: { couponId: true } });
    if (couponId) await releaseCoupon(tx, couponId);
    const items = await tx.orderItem.findMany({ where: { orderId, variantId: { not: null } }, orderBy: { variantId: "asc" } });
    for (const it of items) await tx.variant.updateMany({ where: { id: it.variantId! }, data: { stock: { increment: it.quantity } } });
    return true;
  });
}
