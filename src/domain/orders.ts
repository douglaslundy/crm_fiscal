import type { Order, OrderItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { ShippingError, type ShippingProvider } from "@/integrations/shipping/types";
import { priceCart, type CartIssue, type CartLine } from "./cart";
import { loadVariantRows } from "./cartServer";
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

export type CreateOrderInput = { storeId: string; customerId: string; lines: CartLine[]; addressId: string; shippingService: string };

/**
 * Cria o pedido numa unica transacao: reprecifica do banco, recota o frete no servidor, baixa o estoque e grava os
 * snapshots. Nenhum preco/total do navegador entra aqui. Qualquer divergencia do carrinho = CartChangedError (nunca ajusta).
 * Concorrencia: sem trava da loja; a baixa e um UPDATE condicional por linha (stock >= qty), atomico no Postgres.
 * Linhas em ordem de variantId: dois pedidos com as mesmas variacoes travam na mesma ordem (sem deadlock).
 * shortcut: a cotacao (rede) roda dentro da transacao, segurando uma conexao; mover para antes dela se o pool apertar.
 */
export async function createOrder(input: CreateOrderInput, deps: { provider: ShippingProvider }): Promise<Order & { items: OrderItem[] }> {
  const { storeId, customerId } = input;
  assertStoreCanSell(await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { status: true } }));
  const { originCep } = await getSettings(storeId);

  return dbForStore(storeId).$transaction(async (tx) => {
    // escopo da loja + dono: endereco de outro cliente ou de outra loja nao casa
    const address = await tx.address.findFirst({ where: { id: input.addressId, customerId } });
    if (!address) throw new AddressInvalidError("Endereço inválido");

    const variants = await loadVariantRows(tx, input.lines.map((l) => l.variantId));
    const priced = priceCart(input.lines, variants);
    if (priced.issues.length > 0) throw new CartChangedError(priced.issues);
    if (priced.lines.length === 0) throw new EmptyCartError("Carrinho vazio");

    const dimRows = await tx.variant.findMany({
      where: { id: { in: priced.lines.map((l) => l.variantId) } },
      select: { id: true, product: { select: { weightGrams: true, heightCm: true, widthCm: true, lengthCm: true } } },
    });
    const dims = new Map(dimRows.map((r) => [r.id, r.product]));
    if (hasOversizeItem(priced.lines, dims)) throw new OversizeItemError("Item fora dos limites de envio");
    let options;
    try {
      options = await quotePackages(deps.provider, { fromCep: originCep, toCep: address.cep, packages: buildPackages(priced.lines, dims) });
    } catch (e) {
      throw e instanceof ShippingError ? e : new ShippingError("Falha na cotação", { cause: e });
    }
    const shipping = options.find((o) => o.service === input.shippingService);
    if (!shipping) throw new ShippingOptionInvalidError("Opção de frete indisponível");

    const sorted = [...priced.lines].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));
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
        subtotalCents: priced.subtotalCents, shippingCents: shipping.priceCents, totalCents: priced.subtotalCents + shipping.priceCents,
        shippingService: shipping.service, addressSnapshot: { cep, street, number, complement, district, city, state },
      },
    });
    const sku = new Map(variants.map((v) => [v.id, v.sku]));
    await tx.orderItem.createMany({
      data: priced.lines.map((l) => ({
        storeId, orderId: order.id, variantId: l.variantId, productName: l.productName, sku: sku.get(l.variantId)!,
        color: l.color, size: l.size, unitPriceCents: l.unitCents, quantity: l.qty,
      })),
    });
    return { ...order, items: await tx.orderItem.findMany({ where: { orderId: order.id } }) };
  }, { timeoutMs: 20_000 });
}

/** Cancela pedido aguardando pagamento e devolve o estoque uma unica vez (idempotente). Outros status: nada muda. */
export async function cancelOrder(storeId: string, orderId: string): Promise<void> {
  await dbForStore(storeId).$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELED" } });
    if (count === 0) {
      if (!(await tx.order.findFirst({ where: { id: orderId }, select: { id: true } }))) throw new OrderNotFoundError("Pedido não encontrado");
      return;
    }
    const items = await tx.orderItem.findMany({ where: { orderId, variantId: { not: null } }, orderBy: { variantId: "asc" } });
    for (const it of items) await tx.variant.updateMany({ where: { id: it.variantId! }, data: { stock: { increment: it.quantity } } });
  });
}
