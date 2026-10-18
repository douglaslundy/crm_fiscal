import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreStatus, SubStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FakeBilling } from "@/integrations/billing/fakeBilling";
import type { BillingStatus } from "@/integrations/billing/types";

const fake = new FakeBilling();
vi.mock("@/integrations/billing", () => ({ getBilling: () => fake }));

const {
  GRACE_DAYS, StoreSuspendedError, SubscriptionActionError, applyBillingEvent, assertStoreCanSell, assertStoreWritable,
  cancelStoreSubscription, changeStorePlan, evaluateStoreLifecycle, startCheckout, transition,
} = await import("./subscription");
const { POST: webhook } = await import("@/app/api/webhooks/billing/route");
const { GET: cron } = await import("@/app/api/cron/billing/route");

const DAY = 86400_000;
const NOW = new Date("2027-03-10T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

let tag: string;
let planId: string;
let otherPlanId: string;
let inactivePlanId: string;
const storeIds: string[] = [];

beforeAll(async () => {
  const mk = (name: string, priceCents: number, active = true) =>
    prisma.plan.create({ data: { name, priceCents, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false, active } });
  const t = Math.random().toString(36).slice(2, 8);
  planId = (await mk(`T7-a-${t}`, 4900)).id;
  otherPlanId = (await mk(`T7-b-${t}`, 12900)).id;
  inactivePlanId = (await mk(`T7-x-${t}`, 100, false)).id;
});
beforeEach(() => {
  tag = Math.random().toString(36).slice(2, 8);
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } }); // cascata leva a Subscription
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { id: { in: [planId, otherPlanId, inactivePlanId] } } }); // schema.test conta os planos
  await prisma.$disconnect();
});

let n = 0;
type Fixture = { status?: StoreStatus; sub?: SubStatus; trialEndsAt?: Date | null; graceEndsAt?: Date | null; mp?: string };
async function newStore(f: Fixture = {}) {
  const slug = `t7-${tag}-${n++}`;
  const s = await prisma.store.create({
    data: {
      slug, name: slug, planId, status: f.status ?? "TRIAL", trialEndsAt: f.trialEndsAt === undefined ? at(14) : f.trialEndsAt,
      graceEndsAt: f.graceEndsAt ?? null,
      subscription: { create: { status: f.sub ?? "TRIALING", mpPreapprovalId: f.mp ?? null } },
    },
  });
  storeIds.push(s.id);
  return s.id;
}
const state = async (id: string) => {
  const s = await prisma.store.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
  return { store: s.status, sub: s.subscription!.status, graceEndsAt: s.graceEndsAt, planId: s.planId, mp: s.subscription!.mpPreapprovalId, periodEnd: s.subscription!.currentPeriodEnd };
};
const mine = (ids: string[]) => ids.filter((id) => storeIds.includes(id));

describe("transition (pura)", () => {
  const STORES: StoreStatus[] = ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELED"];
  const SUBS: SubStatus[] = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"];
  const grace = at(1);
  for (const store of STORES) for (const sub of SUBS) for (const graceEndsAt of [null, grace]) {
    const cur = { store, sub, graceEndsAt };
    it(`${store}/${sub}/${graceEndsAt ? "com" : "sem"} carencia`, () => {
      expect(transition(cur, "authorized", NOW)).toEqual({ store: "ACTIVE", sub: "ACTIVE", graceEndsAt: null });
      expect(transition(cur, "pending", NOW)).toEqual(cur);
      expect(transition(cur, "cancelled", NOW)).toEqual({ store: "CANCELED", sub: "CANCELED", graceEndsAt: null });
      const paused = transition(cur, "paused", NOW);
      if (store === "SUSPENDED" || store === "CANCELED") expect(paused).toEqual(cur);
      else expect(paused).toEqual({ store, sub: "PAST_DUE", graceEndsAt: graceEndsAt ?? at(GRACE_DAYS) });
    });
  }
  it("GRACE_DAYS = 3", () => expect(GRACE_DAYS).toBe(3));
});

describe("applyBillingEvent", () => {
  it("autorizado -> loja ACTIVE e assinatura ACTIVE", async () => {
    const id = await newStore();
    await applyBillingEvent(id, "authorized", NOW);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "ACTIVE", graceEndsAt: null });
  });

  it("falha -> PAST_DUE com carencia de 3 dias; segunda falha nao estende; carencia vencida suspende", async () => {
    const id = await newStore({ status: "ACTIVE", sub: "ACTIVE" });
    await applyBillingEvent(id, "paused", NOW);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "PAST_DUE", graceEndsAt: at(3) });
    await applyBillingEvent(id, "paused", at(2));
    expect((await state(id)).graceEndsAt).toEqual(at(3));
    expect(mine((await evaluateStoreLifecycle(at(2))).suspended)).toEqual([]);
    expect((await state(id)).store).toBe("ACTIVE");
    const r = await evaluateStoreLifecycle(at(3));
    expect(mine(r.suspended)).toEqual([id]);
    expect(await state(id)).toMatchObject({ store: "SUSPENDED", sub: "SUSPENDED" });
  });

  it("pendente nao muda nada", async () => {
    const id = await newStore({ status: "ACTIVE", sub: "PAST_DUE", graceEndsAt: at(2) });
    await applyBillingEvent(id, "pending", NOW);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "PAST_DUE", graceEndsAt: at(2) });
  });

  it("reativacao: autorizado em loja SUSPENDED restaura ACTIVE e limpa carencia", async () => {
    const id = await newStore({ status: "SUSPENDED", sub: "SUSPENDED", graceEndsAt: at(-1) });
    await applyBillingEvent(id, "authorized", NOW);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "ACTIVE", graceEndsAt: null });
  });

  it("cancelado -> loja e assinatura CANCELED", async () => {
    const id = await newStore({ status: "ACTIVE", sub: "ACTIVE" });
    await applyBillingEvent(id, "cancelled", NOW);
    expect(await state(id)).toMatchObject({ store: "CANCELED", sub: "CANCELED" });
  });

  it("evento da loja A nunca altera a loja B", async () => {
    const a = await newStore({ status: "ACTIVE", sub: "ACTIVE" });
    const b = await newStore({ status: "ACTIVE", sub: "ACTIVE" });
    const before = await state(b);
    for (const s of ["paused", "cancelled", "authorized"] as BillingStatus[]) await applyBillingEvent(a, s, NOW);
    expect(await state(b)).toEqual(before);
  });
});

describe("evaluateStoreLifecycle", () => {
  it("suspende so os testes vencidos sem assinatura ativa", async () => {
    const expired = await newStore({ trialEndsAt: at(-1) });
    const exactlyNow = await newStore({ trialEndsAt: NOW });
    const running = await newStore({ trialEndsAt: at(1) });
    const paid = await newStore({ trialEndsAt: at(-1), sub: "ACTIVE" }); // autorizado mas loja ainda TRIAL
    const active = await newStore({ status: "ACTIVE", sub: "ACTIVE", trialEndsAt: at(-5) });
    await prisma.store.update({ where: { id: running }, data: { planId: otherPlanId } });
    const r = await evaluateStoreLifecycle(NOW);
    expect(mine(r.suspended).sort()).toEqual([expired, exactlyNow].sort());
    expect(await state(expired)).toMatchObject({ store: "SUSPENDED", sub: "SUSPENDED" });
    expect((await state(running)).store).toBe("TRIAL");
    expect((await state(paid)).store).toBe("TRIAL");
    expect((await state(active)).store).toBe("ACTIVE");
  });

  it("loja com assinatura autorizada nao e suspensa no fim do teste", async () => {
    const id = await newStore({ trialEndsAt: at(-1) });
    await applyBillingEvent(id, "authorized", at(-2));
    await evaluateStoreLifecycle(NOW);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "ACTIVE" });
  });

  it("idempotente: segunda execucao nao muda nem relata nada novo; pastDue lista lojas em carencia", async () => {
    const expired = await newStore({ trialEndsAt: at(-1) });
    const grace = await newStore({ status: "ACTIVE", sub: "PAST_DUE", graceEndsAt: at(-1) });
    const inGrace = await newStore({ status: "ACTIVE", sub: "PAST_DUE", graceEndsAt: at(2) });
    const first = await evaluateStoreLifecycle(NOW);
    expect(mine(first.suspended).sort()).toEqual([expired, grace].sort());
    expect(mine(first.pastDue)).toEqual([inGrace]);
    const snap = await Promise.all(storeIds.map(state));
    const second = await evaluateStoreLifecycle(NOW);
    expect(mine(second.suspended)).toEqual([]);
    expect(mine(second.pastDue)).toEqual([inGrace]);
    expect(await Promise.all(storeIds.map(state))).toEqual(snap);
  });
});

describe("guardas de estado da loja", () => {
  for (const status of ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELED"] as StoreStatus[]) {
    it(status, () => {
      const blocked = status === "SUSPENDED" || status === "CANCELED";
      for (const f of [assertStoreCanSell, assertStoreWritable]) {
        if (blocked) expect(() => f({ status })).toThrow(StoreSuspendedError);
        else expect(() => f({ status })).not.toThrow();
      }
    });
  }
});

describe("acoes do painel", () => {
  it("startCheckout grava o id externo e o plano; recusa plano inativo e assinatura ativa", async () => {
    const id = await newStore();
    await expect(startCheckout(id, inactivePlanId, "d@t.local", fake)).rejects.toMatchObject({ code: "PLAN_NOT_AVAILABLE" });
    const url = await startCheckout(id, otherPlanId, "d@t.local", fake);
    const s = await state(id);
    expect(url).toContain(s.mp!);
    expect(s.planId).toBe(otherPlanId);
    expect(fake.subs.get(s.mp!)).toMatchObject({ storeId: id, planId: otherPlanId, payerEmail: "d@t.local", status: "pending" });
    // novo checkout cancela o anterior pendente
    await startCheckout(id, planId, "d@t.local", fake);
    expect(fake.subs.get(s.mp!)!.status).toBe("cancelled");
    await applyBillingEvent(id, "authorized", NOW);
    await expect(startCheckout(id, planId, "d@t.local", fake)).rejects.toBeInstanceOf(SubscriptionActionError);
  });

  it("changeStorePlan so com assinatura ACTIVE e plano ativo", async () => {
    const id = await newStore();
    await expect(changeStorePlan(id, otherPlanId, fake)).rejects.toMatchObject({ code: "NO_ACTIVE_SUBSCRIPTION" });
    await startCheckout(id, planId, "d@t.local", fake);
    await applyBillingEvent(id, "authorized", NOW);
    await expect(changeStorePlan(id, inactivePlanId, fake)).rejects.toMatchObject({ code: "PLAN_NOT_AVAILABLE" });
    await changeStorePlan(id, otherPlanId, fake);
    const s = await state(id);
    expect(s.planId).toBe(otherPlanId);
    expect(fake.subs.get(s.mp!)!.planId).toBe(otherPlanId);
  });

  it("cancelStoreSubscription cancela no gateway e na loja", async () => {
    const id = await newStore();
    await startCheckout(id, planId, "d@t.local", fake);
    await applyBillingEvent(id, "authorized", NOW);
    await cancelStoreSubscription(id, fake, NOW);
    const s = await state(id);
    expect(s).toMatchObject({ store: "CANCELED", sub: "CANCELED" });
    expect(fake.subs.get(s.mp!)!.status).toBe("cancelled");
  });
});

describe("webhook /api/webhooks/billing", () => {
  const call = (dataId: string, sig = FakeBilling.sign(dataId), type = "subscription_preapproval") =>
    webhook(new Request(`http://x/api/webhooks/billing?data.id=${dataId}&type=${type}`, {
      method: "POST",
      headers: { "x-signature": sig, "content-type": "application/json" },
      body: JSON.stringify({ type, data: { id: dataId } }),
    }));
  async function subscribed() {
    const id = await newStore();
    await startCheckout(id, planId, "d@t.local", fake);
    return { id, mp: (await state(id)).mp! };
  }

  it("assinatura invalida -> 401 e nada muda", async () => {
    const { id, mp } = await subscribed();
    fake.set(mp, "authorized");
    expect((await call(mp, "fake:outro")).status).toBe(401);
    expect((await call(mp, "")).status).toBe(401);
    expect((await state(id)).store).toBe("TRIAL");
  });

  it("valida -> aplica o estado buscado no gateway e grava o proximo pagamento", async () => {
    const { id, mp } = await subscribed();
    fake.set(mp, "authorized", at(30));
    expect((await call(mp)).status).toBe(200);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "ACTIVE", periodEnd: at(30) });
  });

  it("evento repetido e no-op (carencia nao estende)", async () => {
    const { id, mp } = await subscribed();
    fake.set(mp, "authorized");
    await call(mp);
    fake.set(mp, "paused");
    await call(mp);
    const after = await state(id);
    expect(after).toMatchObject({ store: "ACTIVE", sub: "PAST_DUE" });
    await call(mp);
    expect(await state(id)).toEqual(after);
  });

  it("evento antigo fora de ordem nao rebaixa: o estado vem do gateway", async () => {
    const { id, mp } = await subscribed();
    fake.set(mp, "authorized"); // estado atual mais novo
    // corpo diz "pendente" (evento antigo); ignorado
    const res = await webhook(new Request(`http://x/api/webhooks/billing?data.id=${mp}&type=subscription_preapproval`, {
      method: "POST", headers: { "x-signature": FakeBilling.sign(mp) }, body: JSON.stringify({ type: "subscription_preapproval", data: { id: mp }, status: "paused" }),
    }));
    expect(res.status).toBe(200);
    await call(mp);
    expect(await state(id)).toMatchObject({ store: "ACTIVE", sub: "ACTIVE", graceEndsAt: null });
  });

  it("id externo desconhecido -> 200 sem efeito; outros tipos ignorados", async () => {
    const { id, mp } = await subscribed();
    fake.set(mp, "authorized");
    expect((await call("nao-existe")).status).toBe(200);
    expect((await call(mp, FakeBilling.sign(mp), "payment")).status).toBe(200);
    expect((await state(id)).store).toBe("TRIAL");
  });
});

describe("cron /api/cron/billing", () => {
  const req = (auth?: string) => new Request("http://x/api/cron/billing", { headers: auth ? { authorization: auth } : {} });
  afterEach(() => vi.unstubAllEnvs());

  it("401 sem segredo, com segredo errado e se CRON_SECRET nao estiver definido", async () => {
    vi.stubEnv("CRON_SECRET", "s3gredo");
    expect((await cron(req())).status).toBe(401);
    expect((await cron(req("Bearer errado"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron(req("Bearer "))).status).toBe(401);
  });

  it("com o segredo certo roda evaluateStoreLifecycle", async () => {
    vi.stubEnv("CRON_SECRET", "s3gredo");
    const id = await newStore({ trialEndsAt: new Date(Date.now() - DAY) });
    const res = await cron(req("Bearer s3gredo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspended).toContain(id);
    expect(Array.isArray(body.pastDue)).toBe(true);
  });
});
