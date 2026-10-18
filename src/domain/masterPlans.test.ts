import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertCanAddStaff, PlanLimitError } from "./entitlements";
import { PlanNotFoundError } from "./stores";
import { PlanInUseError, PlanNameTakenError, PlanValidationError, type PlanInput, createPlan, deletePlan, setPlanActive, updatePlan } from "./masterPlans";

let tag: string;
const planIds: string[] = [];
const storeIds: string[] = [];
const accountIds: string[] = [];
let n = 0;

const base = (): PlanInput => ({ name: `T8p-${n++}-${tag}`, priceCents: 4900, productLimit: 100, staffLimit: 2, customDomain: false, advancedMetrics: false, csvExport: false });
const mk = async (extra: Partial<PlanInput> = {}) => {
  const p = await createPlan({ ...base(), ...extra });
  planIds.push(p.id);
  return p;
};

beforeEach(() => { tag = Math.random().toString(36).slice(2, 8); });
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds.splice(0) } } });
  await prisma.plan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});
afterAll(() => prisma.$disconnect());

describe("createPlan", () => {
  it("cria com defaults (ativo, taxa 0) e aceita productLimit null", async () => {
    const p = await mk({ productLimit: null });
    expect(p).toMatchObject({ active: true, transactionFeeBps: 0, productLimit: null });
  });
  it("nome unico (case exato do banco)", async () => {
    const p = await mk();
    await expect(createPlan({ ...base(), name: p.name })).rejects.toBeInstanceOf(PlanNameTakenError);
  });
  it("nome unico sem diferenciar maiusculas/espacos, na criacao e na edicao", async () => {
    const p = await mk({ name: `Pro-${tag}` });
    await expect(createPlan({ ...base(), name: `  pRO-${tag} ` })).rejects.toBeInstanceOf(PlanNameTakenError);
    const other = await mk();
    await expect(updatePlan(other.id, { name: `PRO-${tag}` })).rejects.toBeInstanceOf(PlanNameTakenError);
    await expect(updatePlan(p.id, { name: `PRO-${tag}` })).resolves.toMatchObject({ name: `PRO-${tag}` }); // o proprio plano pode mudar a caixa
  });
  it.each([
    ["nome vazio", { name: "  " }],
    ["preco negativo", { priceCents: -1 }],
    ["preco fracionado", { priceCents: 10.5 }],
    ["productLimit 0", { productLimit: 0 }],
    ["staffLimit 0", { staffLimit: 0 }],
    ["taxa > 10000", { transactionFeeBps: 10001 }],
    ["taxa negativa", { transactionFeeBps: -1 }],
    ["taxa fracionada", { transactionFeeBps: 1.5 }],
  ])("rejeita %s", async (_l, extra) => {
    await expect(createPlan({ ...base(), ...extra })).rejects.toBeInstanceOf(PlanValidationError);
  });
  it("limites de borda validos: preco 0, taxa 0 e 10000, productLimit 1", async () => {
    await mk({ priceCents: 0, productLimit: 1, transactionFeeBps: 10000 });
    await mk({ transactionFeeBps: 0 });
  });
});

describe("updatePlan / setPlanActive / deletePlan", () => {
  it("atualiza campos, valida e checa nome duplicado; inexistente -> PlanNotFoundError", async () => {
    const a = await mk();
    const b = await mk();
    expect(await updatePlan(a.id, { priceCents: 100, productLimit: null })).toMatchObject({ priceCents: 100, productLimit: null, name: a.name });
    await expect(updatePlan(a.id, { name: b.name })).rejects.toBeInstanceOf(PlanNameTakenError);
    await expect(updatePlan(a.id, { staffLimit: 0 })).rejects.toBeInstanceOf(PlanValidationError);
    await expect(updatePlan("nao-existe", { priceCents: 1 })).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("editar o plano muda o comportamento das lojas na proxima checagem (sem cache)", async () => {
    const p = await mk({ staffLimit: 1 });
    const s = await prisma.store.create({ data: { slug: `t8p-${tag}`, name: "x", planId: p.id } });
    storeIds.push(s.id);
    const acc = await prisma.account.create({ data: { name: "a", email: `a-${tag}@t.local`, passwordHash: "x" } });
    accountIds.push(acc.id);
    await prisma.storeMember.create({ data: { storeId: s.id, accountId: acc.id, role: "OWNER" } });
    await expect(assertCanAddStaff(s.id)).rejects.toBeInstanceOf(PlanLimitError);
    await updatePlan(p.id, { staffLimit: 3 });
    await expect(assertCanAddStaff(s.id)).resolves.toBeUndefined();
  });

  it("desativa e reativa", async () => {
    const p = await mk();
    expect((await setPlanActive(p.id, false)).active).toBe(false);
    expect((await setPlanActive(p.id, true)).active).toBe(true);
    await expect(setPlanActive("nao-existe", false)).rejects.toBeInstanceOf(PlanNotFoundError);
  });

  it("exclui plano sem lojas; com lojas -> PlanInUseError e o plano permanece", async () => {
    const free = await mk();
    await deletePlan(free.id);
    expect(await prisma.plan.findUnique({ where: { id: free.id } })).toBeNull();
    const used = await mk();
    const s = await prisma.store.create({ data: { slug: `t8pd-${tag}`, name: "x", planId: used.id } });
    storeIds.push(s.id);
    await expect(deletePlan(used.id)).rejects.toBeInstanceOf(PlanInUseError);
    expect(await prisma.plan.findUnique({ where: { id: used.id } })).not.toBeNull();
    await expect(deletePlan("nao-existe")).rejects.toBeInstanceOf(PlanNotFoundError);
  });
});
