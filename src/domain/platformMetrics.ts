import type { StoreStatus } from "@prisma/client";

export type StoreRow = { id: string; status: StoreStatus; createdAt: Date; plan: { name: string; priceCents: number } };

const DAY = 86400_000;
const SIGNUP_DAYS = 30;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Puro. MRR = soma do preco do plano das lojas ACTIVE (TRIAL, SUSPENDED e CANCELED nao entram). */
export function computePlatformMetrics(stores: StoreRow[], now: Date) {
  const count = (s: StoreStatus) => stores.filter((x) => x.status === s).length;
  const byPlan = new Map<string, number>();
  for (const s of stores) byPlan.set(s.plan.name, (byPlan.get(s.plan.name) ?? 0) + 1);

  // janela: 30 dias UTC terminando no dia de `now`; dias sem cadastro entram com 0
  const buckets = new Map<string, number>();
  for (let i = SIGNUP_DAYS - 1; i >= 0; i--) buckets.set(utcDay(new Date(now.getTime() - i * DAY)), 0);
  for (const s of stores) {
    const k = utcDay(s.createdAt);
    if (buckets.has(k)) buckets.set(k, buckets.get(k)! + 1);
  }

  return {
    activeStores: count("ACTIVE"),
    trialingStores: count("TRIAL"),
    suspendedStores: count("SUSPENDED"),
    mrrCents: stores.filter((s) => s.status === "ACTIVE").reduce((sum, s) => sum + s.plan.priceCents, 0),
    storesByPlan: [...byPlan].map(([planName, c]) => ({ planName, count: c })).sort((a, b) => b.count - a.count || a.planName.localeCompare(b.planName)),
    signupsByDay: [...buckets].map(([date, c]) => ({ date, count: c })),
  };
}
