import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import {
  PlanLimitError, StoreNotFoundError, assertCanAddProduct, assertCanAddStaff, assertCanUseCustomDomain, getFeatures, planLimitToHttp,
} from "./entitlements";

let tag: string;
const planIds: Record<"start" | "pro" | "business", string> = { start: "", pro: "", business: "" };
const storeIds: string[] = [];
const accountIds: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  // Planos proprios (nomes unicos): nao mexem nos planos do seed.
  const mk = async (k: keyof typeof planIds, d: { productLimit: number | null; staffLimit: number; customDomain: boolean; advancedMetrics: boolean; csvExport: boolean }) =>
    (planIds[k] = (await prisma.plan.create({ data: { name: `T6-${k}-${tag}`, priceCents: 0, ...d } })).id);
  await mk("start", { productLimit: 50, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false });
  await mk("pro", { productLimit: 500, staffLimit: 5, customDomain: true, advancedMetrics: true, csvExport: false });
  await mk("business", { productLimit: null, staffLimit: 15, customDomain: true, advancedMetrics: true, csvExport: true });
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: { in: Object.values(planIds) } } });
});
afterAll(() => prisma.$disconnect());

let n = 0;
async function newStore(plan: keyof typeof planIds) {
  const slug = `t6-${tag}-${n++}`;
  const s = await prisma.store.create({ data: { slug, name: slug, planId: planIds[plan] } });
  storeIds.push(s.id);
  return s.id;
}
async function addProducts(storeId: string, count: number, active = true) {
  const base = Math.random().toString(36).slice(2, 8);
  await dbForStore(storeId).product.createMany({
    data: Array.from({ length: count }, (_, i) => ({ storeId, slug: `${base}-${i}`, name: "p", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1, active })),
  });
}
async function addMembers(storeId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const a = await prisma.account.create({ data: { name: "m", email: `m${n++}-${tag}@t.local`, passwordHash: "x" } });
    accountIds.push(a.id);
    await prisma.storeMember.create({ data: { storeId, accountId: a.id, role: i === 0 ? "OWNER" : "STAFF" } });
  }
}
const limitErr = (p: Promise<unknown>) => p.then(() => null, (e) => e);

describe("produtos", () => {
  it("Start: 50 produtos barram o 51o (limit 50); 49 passa; inativos contam", async () => {
    const s = await newStore("start");
    await addProducts(s, 49);
    await expect(assertCanAddProduct(s)).resolves.toBeUndefined();
    await addProducts(s, 1, false);
    const e = await limitErr(assertCanAddProduct(s));
    expect(e).toBeInstanceOf(PlanLimitError);
    expect(e).toMatchObject({ code: "PRODUCT_LIMIT", limit: 50 });
  });

  it("Business (limite nulo) nunca barra", async () => {
    const s = await newStore("business");
    await addProducts(s, 60);
    await expect(assertCanAddProduct(s)).resolves.toBeUndefined();
  });

  it("conta por loja: produtos de outra loja nao entram", async () => {
    const a = await newStore("start");
    const b = await newStore("start");
    await addProducts(a, 50);
    await expect(assertCanAddProduct(b)).resolves.toBeUndefined();
  });

  it("com tx + lockStore: N criacoes simultaneas no limite-1 -> so uma passa", async () => {
    const s = await newStore("start");
    await addProducts(s, 49);
    const db = dbForStore(s);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
      db.$transaction(async (tx) => {
        await assertCanAddProduct(s, tx);
        return tx.product.create({ data: { storeId: s, slug: `race-${i}`, name: "r", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 } });
      }, { lockStore: true })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(5);
    for (const r of rejected) expect(r.reason).toMatchObject({ name: "PlanLimitError", code: "PRODUCT_LIMIT", limit: 50 });
    expect(await db.product.count()).toBe(50);
  });

  it("tx conta pelo cliente recebido (escrita ainda nao confirmada conta)", async () => {
    const s = await newStore("start");
    await addProducts(s, 49);
    const db = dbForStore(s);
    const e = await limitErr(db.$transaction(async (tx) => {
      await tx.product.create({ data: { storeId: s, slug: "in-tx", name: "r", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 } });
      await assertCanAddProduct(s, tx);
    }));
    expect(e).toMatchObject({ code: "PRODUCT_LIMIT" });
    expect(await db.product.count()).toBe(49);
  });

  it("assertCanAddStaff aceita cliente de transacao", async () => {
    const s = await newStore("start");
    await addMembers(s, 1);
    expect(await limitErr(prisma.$transaction((tx) => assertCanAddStaff(s, tx)))).toMatchObject({ code: "STAFF_LIMIT" });
  });

  it("trocar Start -> Pro libera sem recriar dados", async () => {
    const s = await newStore("start");
    await addProducts(s, 50);
    await expect(assertCanAddProduct(s)).rejects.toBeInstanceOf(PlanLimitError);
    await prisma.store.update({ where: { id: s }, data: { planId: planIds.pro } });
    await expect(assertCanAddProduct(s)).resolves.toBeUndefined();
  });
});

describe("equipe", () => {
  it("Start com 1 membro (dono) -> STAFF_LIMIT", async () => {
    const s = await newStore("start");
    await addMembers(s, 1);
    expect(await limitErr(assertCanAddStaff(s))).toMatchObject({ code: "STAFF_LIMIT", limit: 1 });
  });

  it("Pro: 4 membros passa o 5o, 5 membros barra o 6o", async () => {
    const s = await newStore("pro");
    await addMembers(s, 4);
    await expect(assertCanAddStaff(s)).resolves.toBeUndefined();
    await addMembers(s, 1);
    expect(await limitErr(assertCanAddStaff(s))).toMatchObject({ code: "STAFF_LIMIT", limit: 5 });
  });
});

describe("dominio e recursos", () => {
  it("Start -> DOMAIN_NOT_ALLOWED; Pro passa", async () => {
    const e = await limitErr(assertCanUseCustomDomain(await newStore("start")));
    expect(e).toBeInstanceOf(PlanLimitError);
    expect(e).toMatchObject({ code: "DOMAIN_NOT_ALLOWED" });
    await expect(assertCanUseCustomDomain(await newStore("pro"))).resolves.toBeUndefined();
  });

  it("getFeatures por plano", async () => {
    expect(await getFeatures(await newStore("start"))).toEqual({ advancedMetrics: false, csvExport: false });
    expect(await getFeatures(await newStore("pro"))).toEqual({ advancedMetrics: true, csvExport: false });
    expect(await getFeatures(await newStore("business"))).toEqual({ advancedMetrics: true, csvExport: true });
  });
});

describe("loja inexistente e HTTP", () => {
  it("falha fechada com StoreNotFoundError em todas as funcoes", async () => {
    for (const f of [assertCanAddProduct, assertCanAddStaff, assertCanUseCustomDomain, getFeatures]) {
      await expect(f("nao-existe")).rejects.toBeInstanceOf(StoreNotFoundError);
    }
  });

  it("planLimitToHttp -> 403 com mensagem em portugues", () => {
    expect(planLimitToHttp(new PlanLimitError("PRODUCT_LIMIT", 50))).toEqual({
      status: 403,
      body: { error: "PLAN_LIMIT", code: "PRODUCT_LIMIT", limit: 50, message: "Seu plano permite até 50 produtos. Faça upgrade para continuar." },
    });
    const staff = planLimitToHttp(new PlanLimitError("STAFF_LIMIT", 1));
    expect(staff.status).toBe(403);
    expect(staff.body.message).toBe("Seu plano permite até 1 usuário. Faça upgrade para continuar.");
    const dom = planLimitToHttp(new PlanLimitError("DOMAIN_NOT_ALLOWED"));
    expect(dom.body).not.toHaveProperty("limit");
    expect(dom.body.message).toMatch(/domínio próprio/);
  });
});
