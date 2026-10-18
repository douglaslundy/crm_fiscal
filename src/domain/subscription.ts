import type { Prisma, StoreStatus, SubStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { BillingGateway, BillingStatus } from "@/integrations/billing/types";
import { StoreNotFoundError } from "./entitlements";

export const GRACE_DAYS = 3;
const DAY = 86400_000;

export type LifecycleState = { store: StoreStatus; sub: SubStatus; graceEndsAt: Date | null };

/**
 * Maquina de estados da assinatura (pura). O status vem sempre do gateway (getSubscription), nunca do corpo do webhook.
 * - authorized: loja e assinatura ACTIVE, carencia limpa. Tambem reativa SUSPENDED.
 *   CANCELED so revive por uma NOVA assinatura autorizada: cancelada no Mercado Pago e terminal, e startCheckout
 *   troca Subscription.mpPreapprovalId, entao eventos da assinatura antiga nao acham mais a loja.
 * - pending: nada muda.
 * - paused (pagamento falhou): assinatura PAST_DUE, loja mantem o status; carencia de 3 dias definida so uma vez
 *   (falha repetida nao estende). Loja SUSPENDED/CANCELED nao muda.
 * - cancelled: loja e assinatura CANCELED.
 */
export function transition(cur: LifecycleState, event: BillingStatus, now: Date): LifecycleState {
  switch (event) {
    case "authorized":
      return { store: "ACTIVE", sub: "ACTIVE", graceEndsAt: null };
    case "pending":
      return cur;
    case "paused":
      if (cur.store === "SUSPENDED" || cur.store === "CANCELED") return cur;
      return { store: cur.store, sub: "PAST_DUE", graceEndsAt: cur.graceEndsAt ?? new Date(now.getTime() + GRACE_DAYS * DAY) };
    case "cancelled":
      return { store: "CANCELED", sub: "CANCELED", graceEndsAt: null };
  }
}

const same = (a: LifecycleState, b: LifecycleState) =>
  a.store === b.store && a.sub === b.sub && a.graceEndsAt?.getTime() === b.graceEndsAt?.getTime();

// Concorrencia: todo escritor de estado (webhook e cron) trava a linha da Store (FOR UPDATE) e le/decide/escreve
// na mesma transacao interativa; assim o cron nunca sobrescreve um authorized recem-gravado e vice-versa.
export const lockStores = (tx: Prisma.TransactionClient, ids: string[]) =>
  tx.$queryRaw`SELECT id FROM "Store" WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`; // ordem fixa: sem deadlock

export type ApplyOptions = {
  /** Proximo pagamento informado pelo gateway; gravado na mesma transacao (undefined = nao mexe). */
  periodEnd?: Date | null;
  _testAfterRead?: () => Promise<void>;
};
export async function applyBillingEvent(storeId: string, status: BillingStatus, now: Date, opts: ApplyOptions = {}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockStores(tx, [storeId]);
    const s = await tx.store.findUnique({ where: { id: storeId }, select: { status: true, graceEndsAt: true, subscription: { select: { status: true } } } });
    if (!s) throw new StoreNotFoundError(`Loja ${storeId} nao encontrada`);
    const cur: LifecycleState = { store: s.status, sub: s.subscription?.status ?? "TRIALING", graceEndsAt: s.graceEndsAt };
    const next = transition(cur, status, now);
    await opts._testAfterRead?.();
    const period = opts.periodEnd === undefined ? {} : { currentPeriodEnd: opts.periodEnd };
    if (same(cur, next)) {
      // evento repetido: estado nao muda (so o proximo pagamento, se veio)
      if (opts.periodEnd !== undefined) await tx.subscription.updateMany({ where: { storeId }, data: period });
      return;
    }
    await tx.store.update({ where: { id: storeId }, data: { status: next.store, graceEndsAt: next.graceEndsAt } });
    await tx.subscription.upsert({ where: { storeId }, create: { storeId, status: next.sub, ...period }, update: { status: next.sub, ...period } });
  });
}

/**
 * Cron: suspende testes vencidos sem assinatura ACTIVE e carencias vencidas ainda PAST_DUE.
 * Idempotente (lojas ja SUSPENDED nao entram de novo); so relata as lojas realmente suspensas nesta execucao. `pastDue` = lojas ainda dentro da carencia (informativo).
 */
export async function evaluateStoreLifecycle(now: Date, opts: { _testBeforeWrite?: () => Promise<void> } = {}): Promise<{ suspended: string[]; pastDue: string[] }> {
  const open: StoreStatus[] = ["TRIAL", "ACTIVE"];
  const expired: Prisma.StoreWhereInput = {
    status: { in: open },
    OR: [
      { status: "TRIAL", trialEndsAt: { lte: now }, NOT: { subscription: { is: { status: "ACTIVE" } } } },
      { graceEndsAt: { lte: now }, subscription: { is: { status: "PAST_DUE" } } },
    ],
  };
  return prisma.$transaction(async (tx) => {
    const ids = (await tx.store.findMany({ where: expired, select: { id: true } })).map((s) => s.id);
    // trava os candidatos e reavalia: um webhook que gravou entre o SELECT e a trava tira a loja da lista
    if (ids.length) await lockStores(tx, ids);
    await opts._testBeforeWrite?.();
    const suspended = ids.length
      ? (await tx.store.findMany({ where: { AND: [expired, { id: { in: ids } }] }, select: { id: true } })).map((s) => s.id)
      : [];
    if (suspended.length) {
      await tx.store.updateMany({ where: { id: { in: suspended } }, data: { status: "SUSPENDED" } });
      await tx.subscription.updateMany({ where: { storeId: { in: suspended } }, data: { status: "SUSPENDED" } });
    }
    const pastDue = await tx.store.findMany({
      where: { status: { in: open }, graceEndsAt: { gt: now }, subscription: { is: { status: "PAST_DUE" } } },
      select: { id: true },
    });
    return { suspended, pastDue: pastDue.map((s) => s.id) };
  });
}

// ---------- guardas de estado da loja ----------

export class StoreSuspendedError extends Error {
  name = "StoreSuspendedError";
  constructor(readonly status: StoreStatus) {
    super(`Loja ${status === "CANCELED" ? "cancelada" : "suspensa"}`);
  }
}

export const isStoreBlocked = (store: { status: StoreStatus }) => store.status === "SUSPENDED" || store.status === "CANCELED";

/** Vitrine: loja SUSPENDED/CANCELED nao vende (leitura continua). */
export function assertStoreCanSell(store: { status: StoreStatus }): void {
  if (isStoreBlocked(store)) throw new StoreSuspendedError(store.status);
}

/** Painel: loja SUSPENDED/CANCELED fica so leitura (exceto a propria pagina de assinatura). */
export function assertStoreWritable(store: { status: StoreStatus }): void {
  if (isStoreBlocked(store)) throw new StoreSuspendedError(store.status);
}

// ---------- acoes do painel (pagina Assinatura) ----------

export type SubscriptionActionCode = "PLAN_NOT_AVAILABLE" | "ALREADY_SUBSCRIBED" | "NO_ACTIVE_SUBSCRIPTION";
export class SubscriptionActionError extends Error {
  name = "SubscriptionActionError";
  constructor(readonly code: SubscriptionActionCode) {
    super(code);
  }
}

async function activePlan(planId: string) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, active: true }, select: { id: true } });
  if (!plan) throw new SubscriptionActionError("PLAN_NOT_AVAILABLE");
}
const subOf = (storeId: string) => prisma.subscription.findUniqueOrThrow({ where: { storeId } });

/** Gera o link de pagamento. Recusa se ja ha assinatura em dia ou em atraso (usar trocar plano / regularizar no MP). */
export async function startCheckout(storeId: string, planId: string, payerEmail: string, gw: BillingGateway): Promise<string> {
  await activePlan(planId);
  const sub = await subOf(storeId);
  if (sub.status === "ACTIVE" || sub.status === "PAST_DUE") throw new SubscriptionActionError("ALREADY_SUBSCRIBED");
  const { checkoutUrl, externalId } = await gw.createSubscription({ storeId, planId, payerEmail });
  // grava o id novo antes de cancelar o antigo: o webhook do cancelamento antigo nao acha mais a loja.
  await prisma.$transaction([
    prisma.subscription.update({ where: { storeId }, data: { mpPreapprovalId: externalId } }),
    prisma.store.update({ where: { id: storeId }, data: { planId } }),
  ]);
  if (sub.mpPreapprovalId && sub.status !== "CANCELED") await gw.cancel(sub.mpPreapprovalId);
  return checkoutUrl;
}

export async function changeStorePlan(storeId: string, planId: string, gw: BillingGateway): Promise<void> {
  const sub = await subOf(storeId);
  if (sub.status !== "ACTIVE" || !sub.mpPreapprovalId) throw new SubscriptionActionError("NO_ACTIVE_SUBSCRIPTION");
  await activePlan(planId);
  await gw.changePlan(sub.mpPreapprovalId, planId);
  await prisma.store.update({ where: { id: storeId }, data: { planId } });
}

export async function cancelStoreSubscription(storeId: string, gw: BillingGateway, now: Date): Promise<void> {
  const sub = await subOf(storeId);
  if (sub.mpPreapprovalId && sub.status !== "CANCELED") await gw.cancel(sub.mpPreapprovalId);
  await applyBillingEvent(storeId, "cancelled", now);
}
