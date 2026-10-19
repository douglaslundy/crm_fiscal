import { createHash } from "node:crypto";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { gatewayForStore } from "@/integrations/payments";
import { isPixType, PaymentGatewayError, type PaymentGateway, type PaymentStatus } from "@/integrations/payments/types";
import { pixPriceCents } from "./money";
import { cancelOrder, OrderNotFoundError } from "./orders";
import { getSettings } from "./storeSettings";
import { assertStoreCanSell } from "./subscription";

export type PaymentMethod = "card" | "pix";

/**
 * Valor cobrado: cartao = total do pedido; Pix = total com o desconto da loja, centavo para baixo (pixPriceCents: o cliente
 * nunca paga mais do que viu). Sempre calculado aqui a partir do pedido; valor vindo do navegador nao existe.
 */
export const amountFor = (method: PaymentMethod, totalCents: number, pixDiscountPercent: number) =>
  method === "pix" ? pixPriceCents(totalCents, pixDiscountPercent) : totalCents;

// shortcut: alerta = linha JSON no log de erro; precisa de alerta real + fluxo de estorno (Task 20).
const alert = (kind: string, data: Record<string, unknown>) => console.error(JSON.stringify({ alert: kind, ...data }));

export type UpdateResult = "paid" | "canceled" | "noop" | "alert";

/**
 * Unica porta de mudanca de status por pagamento: so PENDING_PAYMENT -> PAID | CANCELED, por UPDATE condicional
 * (webhook repetido, cron e cancelamento concorrentes: exatamente uma transicao; estoque devolvido uma vez).
 * - approved: PAID e registra qual pagamento pagou. Pedido ja CANCELED (expirou, estoque liberado) -> nao muda, alerta.
 * - rejected/cancelled: cancela so se `paymentId` ainda for o pagamento atual (tentativa antiga recusada nao derruba a nova).
 * - refunded: v1 nao muda nada, so alerta. pending: nada.
 */
export async function applyPaymentUpdate(storeId: string, orderId: string, status: PaymentStatus, paymentId: string): Promise<UpdateResult> {
  const db = dbForStore(storeId);
  const ctx = { storeId, orderId, paymentId };
  if (status === "approved") {
    const { count } = await db.order.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "PAID", mpPaymentId: paymentId } });
    if (count > 0) return "paid";
    const o = await db.order.findFirst({ where: { id: orderId }, select: { status: true, mpPaymentId: true } });
    if (!o) throw new OrderNotFoundError("Pedido não encontrado");
    if (o.status === "CANCELED") return alert("PAID_FOR_CANCELED_ORDER", ctx), "alert";
    if (o.mpPaymentId !== paymentId) return alert("DUPLICATE_PAYMENT", { ...ctx, paidWith: o.mpPaymentId }), "alert";
    return "noop";
  }
  if (status === "rejected" || status === "cancelled") {
    return (await cancelOrder(storeId, orderId, { onlyIfPaymentId: paymentId })) ? "canceled" : "noop";
  }
  if (status === "refunded") return alert("PAYMENT_REFUNDED", ctx), "alert";
  return "noop";
}

/**
 * Relê o pagamento no gateway DA LOJA (nunca confia no corpo do webhook) e aplica. externalReference = orderId e precisa
 * ser desta loja (senao "not_found", nada muda). approved com valor diferente do esperado -> alerta, nao vira PAID.
 * Pix: esperado = valor gravado na criacao do QR (pixAmountCents); pedido antigo sem ele recalcula com o desconto atual.
 */
export async function syncPayment(storeId: string, paymentId: string, gw: PaymentGateway): Promise<UpdateResult | "not_found"> {
  const p = await gw.getPayment(paymentId);
  const order = p.externalReference
    ? await dbForStore(storeId).order.findFirst({ where: { id: p.externalReference }, select: { id: true, totalCents: true, pixAmountCents: true } })
    : null;
  if (!order) return "not_found";
  if (p.status === "approved") {
    const pix = isPixType(p.paymentTypeId);
    const expectedCents = pix && order.pixAmountCents !== null
      ? order.pixAmountCents
      : amountFor(pix ? "pix" : "card", order.totalCents, pix ? (await getSettings(storeId)).pixDiscountPercent : 0);
    if (p.amountCents !== expectedCents) {
      alert("PAYMENT_AMOUNT_MISMATCH", { storeId, orderId: order.id, paymentId: p.id, amountCents: p.amountCents, expectedCents });
      return "alert";
    }
  }
  return applyPaymentUpdate(storeId, order.id, p.status, p.id);
}

export type PayErrorCode = "NOT_FOUND" | "NOT_PENDING" | "PIX_EXPIRED" | "PIX_LIVE" | "REJECTED";
export class PayError extends Error {
  name = "PayError";
  constructor(readonly code: PayErrorCode) { super(code); }
}

export type PayInput = {
  storeId: string; customerId: string; orderId: string; method: PaymentMethod;
  card?: { token: string; installments: number; paymentMethodId: string };
};
export type PayResult = {
  status: OrderStatus;
  pix?: { qrCode: string; qrCodeBase64: string | null; expiresAt: Date; amountCents: number };
};

/**
 * Paga um pedido PENDING_PAYMENT do proprio cliente. Pix: QR vigente e reaproveitado; senao cria (chave order:<id>:pix).
 * Cartao: so o token do Brick (chave por token); approved -> PAID; pending -> aguarda o webhook; recusado -> o pedido
 * continua aguardando (outro cartao ate expirar) e o id recusado NAO vira o pagamento atual (o webhook dele e ignorado).
 * Com Pix vigente o cartao e recusado (PIX_LIVE) antes de cobrar: o Pix segue sendo o pagamento atual (sem cobranca dupla
 * e sem perder a conciliacao do Pix no cron).
 */
export async function payOrder(input: PayInput, gw: PaymentGateway, now = new Date()): Promise<PayResult> {
  const { storeId, customerId, orderId } = input;
  assertStoreCanSell(await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { status: true } }));
  const db = dbForStore(storeId);
  const order = await db.order.findFirst({
    where: { id: orderId, customerId },
    select: { id: true, status: true, totalCents: true, pixQrCode: true, pixExpiresAt: true, pixAmountCents: true },
  });
  if (!order) throw new PayError("NOT_FOUND");
  if (order.status !== "PENDING_PAYMENT") throw new PayError("NOT_PENDING");
  const customer = await db.customer.findFirstOrThrow({ where: { id: customerId }, select: { email: true, cpf: true } });
  const payer = { email: customer.email, cpf: customer.cpf };
  const pending = { id: orderId, status: "PENDING_PAYMENT" as const };

  if (input.method === "pix") {
    if (order.pixQrCode && order.pixExpiresAt) {
      if (order.pixExpiresAt <= now) throw new PayError("PIX_EXPIRED");
      const amountCents = order.pixAmountCents ?? amountFor("pix", order.totalCents, (await getSettings(storeId)).pixDiscountPercent);
      return { status: order.status, pix: { qrCode: order.pixQrCode, qrCodeBase64: null, expiresAt: order.pixExpiresAt, amountCents } };
    }
    const amountCents = amountFor("pix", order.totalCents, (await getSettings(storeId)).pixDiscountPercent);
    const r = await gw.payPix({ orderId, amountCents, payer }, `order:${orderId}:pix`);
    const { count } = await db.order.updateMany({ where: pending, data: { mpPaymentId: r.id, pixQrCode: r.qrCode, pixExpiresAt: r.expiresAt, pixAmountCents: amountCents } });
    if (count === 0) throw new PayError("NOT_PENDING");
    return { status: "PENDING_PAYMENT", pix: { qrCode: r.qrCode, qrCodeBase64: r.qrCodeBase64 || null, expiresAt: r.expiresAt, amountCents } };
  }

  const card = input.card;
  if (!card) throw new Error("Pagamento com cartão sem token");
  if (order.pixExpiresAt && order.pixExpiresAt > now) throw new PayError("PIX_LIVE");
  const key = `order:${orderId}:card:${createHash("sha256").update(card.token).digest("hex").slice(0, 16)}`;
  const r = await gw.payCard({ orderId, amountCents: order.totalCents, ...card, payer }, key);
  if (r.status === "approved") {
    // noop = mesmo pagamento ja aplicado (envio duplicado concorrente): continua pago
    if ((await applyPaymentUpdate(storeId, orderId, "approved", r.id)) !== "alert") return { status: "PAID" };
    throw new PayError("NOT_PENDING"); // cancelado no meio (cron) ou pago por outro pagamento: alerta ja emitido
  }
  if (r.status === "pending") {
    const { count } = await db.order.updateMany({ where: pending, data: { mpPaymentId: r.id } });
    if (count === 0) throw new PayError("NOT_PENDING");
    return { status: "PENDING_PAYMENT" };
  }
  throw new PayError("REJECTED");
}

const EXPIRE_BATCH = 200;
const UNPAID_TTL_MS = 60 * 60_000;

/**
 * Cron: cancela (devolvendo estoque) pedidos PENDING_PAYMENT com Pix vencido ou sem Pix ha mais de 60 min (inclui cartao
 * ainda pendente; cartao pendente feito depois de um Pix e cancelado no vencimento desse Pix). Antes, pedido com pagamento
 * e conferido no gateway: pago mas webhook perdido vira PAID, nao cancelado; gateway fora do ar ou alerta (valor divergente,
 * estorno) = pedido pulado, nunca cancelado as cegas. Ate 200 pedidos por loja por rodada; loja com erro nao para as outras.
 * Pagamento inexistente no gateway (404) nunca concilia sozinho: um alerta PAYMENT_UNRECONCILABLE por rodada lista os pedidos.
 */
export async function expireOrders(now: Date, deps: { gatewayFor?: (storeId: string) => Promise<PaymentGateway> } = {}) {
  const gatewayFor = deps.gatewayFor ?? ((id: string) => gatewayForStore(id));
  const due = {
    status: "PENDING_PAYMENT" as const,
    OR: [{ pixExpiresAt: { lt: now } }, { pixExpiresAt: null, createdAt: { lt: new Date(now.getTime() - UNPAID_TTL_MS) } }],
  };
  const stores = await prisma.store.findMany({ where: { orders: { some: due } }, select: { id: true } });
  const out = { canceled: 0, paid: 0, skipped: 0, failedStores: [] as string[] };
  const missing: { storeId: string; orderId: string }[] = [];
  for (const { id: storeId } of stores) {
    try {
      const orders = await dbForStore(storeId).order.findMany({ where: due, select: { id: true, mpPaymentId: true }, orderBy: { createdAt: "asc" }, take: EXPIRE_BATCH });
      let gw: PaymentGateway | undefined;
      for (const o of orders) {
        if (o.mpPaymentId) {
          let r;
          try {
            gw ??= await gatewayFor(storeId);
            r = await syncPayment(storeId, o.mpPaymentId, gw);
          } catch (e) {
            console.error(`[expire-orders] loja ${storeId} pedido ${o.id}: pagamento nao conferido`, e instanceof Error ? e.name : "");
            if (e instanceof PaymentGatewayError && e.status === 404) missing.push({ storeId, orderId: o.id });
            out.skipped++;
            continue;
          }
          if (r === "paid") { out.paid++; continue; }
          if (r === "canceled") { out.canceled++; continue; }
          if (r === "alert") { out.skipped++; continue; } // precisa de humano: nao cancela
        }
        if (await cancelOrder(storeId, o.id)) out.canceled++;
      }
    } catch (e) {
      console.error(`[expire-orders] loja ${storeId} falhou`, e instanceof Error ? e.name : "");
      out.failedStores.push(storeId);
    }
  }
  // shortcut: repete a cada rodada enquanto o pedido existir (sem contador persistente de falhas); basta para log/alerta.
  if (missing.length) alert("PAYMENT_UNRECONCILABLE", { orders: missing });
  return out;
}
