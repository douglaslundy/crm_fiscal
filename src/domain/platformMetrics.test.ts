import { describe, expect, it } from "vitest";
import { computePlatformMetrics, type StoreRow } from "./platformMetrics";

const now = new Date("2026-03-31T15:00:00Z");
let n = 0;
const row = (status: StoreRow["status"], plan: string, priceCents: number, createdAt = "2026-03-31T01:00:00Z"): StoreRow => ({
  id: `s${n++}`, status, createdAt: new Date(createdAt), plan: { name: plan, priceCents },
});

describe("computePlatformMetrics", () => {
  it("zero lojas: zeros, listas vazias nos planos e 30 dias zerados", () => {
    const m = computePlatformMetrics([], now);
    expect(m).toMatchObject({ activeStores: 0, trialingStores: 0, suspendedStores: 0, mrrCents: 0, storesByPlan: [] });
    expect(m.signupsByDay).toHaveLength(30);
    expect(m.signupsByDay.every((d) => d.count === 0)).toBe(true);
  });

  it("MRR soma so ACTIVE; TRIAL, SUSPENDED e CANCELED ficam fora", () => {
    const m = computePlatformMetrics([
      row("ACTIVE", "Pro", 9900), row("ACTIVE", "Start", 2900), row("TRIAL", "Pro", 9900),
      row("SUSPENDED", "Pro", 9900), row("CANCELED", "Pro", 9900),
    ], now);
    expect(m).toMatchObject({ activeStores: 2, trialingStores: 1, suspendedStores: 1, mrrCents: 12800 });
  });

  it("agrupa por plano: contagem desc, depois nome", () => {
    const m = computePlatformMetrics([
      row("ACTIVE", "Start", 1), row("TRIAL", "Pro", 1), row("ACTIVE", "Pro", 1), row("ACTIVE", "Business", 1), row("ACTIVE", "Business", 1),
    ], now);
    expect(m.storesByPlan).toEqual([{ planName: "Business", count: 2 }, { planName: "Pro", count: 2 }, { planName: "Start", count: 1 }]);
  });

  it("cadastros por dia UTC: 30 dias ascendentes, com dias zerados, janela [hoje-29, hoje]", () => {
    const m = computePlatformMetrics([
      row("TRIAL", "A", 0, "2026-03-31T00:00:00Z"), row("TRIAL", "A", 0, "2026-03-31T23:59:59Z"),
      row("TRIAL", "A", 0, "2026-03-02T00:00:00Z"), // primeiro dia da janela
      row("TRIAL", "A", 0, "2026-03-01T23:59:59Z"), // fora
      row("TRIAL", "A", 0, "2026-03-15T10:00:00Z"),
      row("TRIAL", "A", 0, "2026-04-01T00:00:00Z"), // futuro: fora
    ], now);
    const d = m.signupsByDay;
    expect(d).toHaveLength(30);
    expect(d[0]).toEqual({ date: "2026-03-02", count: 1 });
    expect(d[29]).toEqual({ date: "2026-03-31", count: 2 });
    expect(d.find((x) => x.date === "2026-03-15")?.count).toBe(1);
    expect(d.find((x) => x.date === "2026-03-10")?.count).toBe(0);
    expect(d.reduce((s, x) => s + x.count, 0)).toBe(4);
    expect(d.map((x) => x.date)).toEqual([...d.map((x) => x.date)].sort());
  });
});
