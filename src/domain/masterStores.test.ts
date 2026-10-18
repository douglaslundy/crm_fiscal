import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PasswordRequiredError, PlanNotFoundError, SlugInvalidError } from "./stores";
import { changeStorePlan, createStoreAsMaster, reactivateStore, suspendStore, updateStore } from "./masterStores";
import { applyBillingEvent, evaluateStoreLifecycle } from "./subscription";
import { StoreNotFoundError } from "./entitlements";

const PW = "senha-forte-1";
let tag: string;
let planId: string;
let otherPlanId: string;
let inactivePlanId: string;
const planIds: string[] = [];
const slugs: string[] = [];
const emails: string[] = [];
let n = 0;

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  const mk = async (k: string, active = true) => {
    const p = await prisma.plan.create({ data: { name: `T8m-${k}-${tag}`, priceCents: 1000, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false, active } });
    planIds.push(p.id);
    return p.id;
  };
  planId = await mk("a");
  otherPlanId = await mk("b");
  inactivePlanId = await mk("off", false);
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { slug: { in: slugs.splice(0) } } });
  await prisma.account.deleteMany({ where: { email: { in: emails.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});
afterAll(() => prisma.$disconnect());

function input(extra: Record<string, unknown> = {}) {
  const i = n++;
  const slug = `t8m-${i}-${tag}`;
  const email = `dono-${i}-${tag}@t.local`;
  slugs.push(slug);
  emails.push(email);
  return { ownerName: "Dono", email, password: PW, storeName: "Loja M", slug, planId, startMode: "trial" as const, ...extra };
}
const sub = (storeId: string) => prisma.subscription.findUnique({ where: { storeId } });
const store = (id: string) => prisma.store.findUniqueOrThrow({ where: { id } });
const create = (extra: Record<string, unknown> = {}) => createStoreAsMaster(input(extra), { db: prisma });

describe("createStoreAsMaster", () => {
  it("trial: loja TRIAL com 14 dias e assinatura TRIALING", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { store: s } = await createStoreAsMaster(input(), { db: prisma, now: () => now });
    expect(s).toMatchObject({ status: "TRIAL", trialEndsAt: new Date("2026-01-15T00:00:00Z") });
    expect((await sub(s.id))?.status).toBe("TRIALING");
  });

  it("active: loja ACTIVE, assinatura ACTIVE sem preapproval, sem fim de teste; o cron nao toca", async () => {
    const { store: s } = await create({ startMode: "active" });
    expect(s).toMatchObject({ status: "ACTIVE", trialEndsAt: null });
    expect(await sub(s.id)).toMatchObject({ status: "ACTIVE", mpPreapprovalId: null });
    const r = await evaluateStoreLifecycle(new Date("2099-01-01T00:00:00Z"));
    expect(r.suspended).not.toContain(s.id);
    expect((await store(s.id)).status).toBe("ACTIVE");
  });

  it("e-mail existente: reutiliza a conta (OWNER novo) e ignora a senha", async () => {
    const first = await create();
    const i = input({ email: first.account.email, password: undefined });
    const second = await createStoreAsMaster(i, { db: prisma });
    expect(second.account.id).toBe(first.account.id);
    expect(await prisma.storeMember.findUnique({ where: { storeId_accountId: { storeId: second.store.id, accountId: first.account.id } } })).toMatchObject({ role: "OWNER" });
    expect(await prisma.account.count({ where: { email: first.account.email } })).toBe(1);
  });

  it("conta nova sem senha (ou curta) e rejeitada e nada e criado", async () => {
    const i = input({ password: undefined });
    await expect(createStoreAsMaster(i, { db: prisma })).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(createStoreAsMaster(input({ password: "curta" }), { db: prisma })).rejects.toBeInstanceOf(PasswordRequiredError);
    expect(await prisma.store.count({ where: { slug: i.slug } })).toBe(0);
    expect(await prisma.account.count({ where: { email: i.email } })).toBe(0);
  });

  it("slug invalido ou reservado e plano inativo/inexistente sao rejeitados", async () => {
    await expect(create({ slug: "Slug Inválido" })).rejects.toBeInstanceOf(SlugInvalidError);
    await expect(create({ slug: "master" })).rejects.toBeInstanceOf(SlugInvalidError);
    await expect(create({ planId: inactivePlanId })).rejects.toBeInstanceOf(PlanNotFoundError);
    await expect(create({ planId: "nao-existe" })).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});

describe("suspend / reactivate / changePlan / update", () => {
  it("suspendStore: loja e assinatura SUSPENDED; outras lojas intactas", async () => {
    const a = (await create({ startMode: "active" })).store;
    const b = (await create({ startMode: "active" })).store;
    await suspendStore(a.id);
    expect((await store(a.id)).status).toBe("SUSPENDED");
    expect((await sub(a.id))?.status).toBe("SUSPENDED");
    expect((await store(b.id)).status).toBe("ACTIVE");
    expect((await sub(b.id))?.status).toBe("ACTIVE");
  });

  it("reactivateStore: ACTIVE nos dois e carencia limpa", async () => {
    const a = (await create()).store;
    await applyBillingEvent(a.id, "paused", new Date()); // define graceEndsAt
    expect((await store(a.id)).graceEndsAt).not.toBeNull();
    await suspendStore(a.id);
    await reactivateStore(a.id);
    expect(await store(a.id)).toMatchObject({ status: "ACTIVE", graceEndsAt: null });
    expect((await sub(a.id))?.status).toBe("ACTIVE");
  });

  it("changeStorePlan: troca so Store.planId; plano inativo ou inexistente rejeitado", async () => {
    const a = (await create()).store;
    const other = (await create()).store;
    await changeStorePlan(a.id, otherPlanId);
    expect((await store(a.id)).planId).toBe(otherPlanId);
    expect((await store(a.id)).status).toBe("TRIAL");
    expect((await store(other.id)).planId).toBe(planId);
    await expect(changeStorePlan(a.id, inactivePlanId)).rejects.toBeInstanceOf(PlanNotFoundError);
    await expect(changeStorePlan(a.id, "nao-existe")).rejects.toBeInstanceOf(PlanNotFoundError);
    expect((await store(a.id)).planId).toBe(otherPlanId);
  });

  it("updateStore renomeia; loja inexistente lanca StoreNotFoundError em todas as acoes", async () => {
    const a = (await create()).store;
    await updateStore(a.id, { name: "Novo Nome" });
    expect((await store(a.id)).name).toBe("Novo Nome");
    await expect(updateStore("x", { name: "Nome" })).rejects.toBeInstanceOf(StoreNotFoundError);
    await expect(suspendStore("x")).rejects.toBeInstanceOf(StoreNotFoundError);
    await expect(reactivateStore("x")).rejects.toBeInstanceOf(StoreNotFoundError);
    await expect(changeStorePlan("x", planId)).rejects.toBeInstanceOf(StoreNotFoundError);
  });

  it("trava a linha da Store: acao fica esperando uma transacao que a segura", async () => {
    const a = (await create({ startMode: "active" })).store;
    let released!: () => void;
    const gate = new Promise<void>((r) => (released = r));
    let acquired!: () => void;
    const held = new Promise<void>((r) => (acquired = r));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${a.id} FOR UPDATE`;
      acquired();
      await gate;
    });
    await held;
    let done = false;
    const p = suspendStore(a.id).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false);
    released();
    await holder;
    await p;
    expect((await store(a.id)).status).toBe("SUSPENDED");
  });
});
