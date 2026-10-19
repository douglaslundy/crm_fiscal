import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { EmailExistsError, PlanNotFoundError, SlugInvalidError, SlugTakenError, createStore, isSlugAvailable } from "./stores";
import { POST } from "@/app/api/signup/route";

const PW = "senha-forte-1";
let tag: string;
let planId: string;
const slugs: string[] = [];
const emails: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Stores" },
    update: {},
    create: { name: "Teste-Stores", priceCents: 0, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { slug: { in: slugs.splice(0) } } });
  await prisma.account.deleteMany({ where: { email: { in: emails.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Stores" } }); // schema.test conta os planos
  await prisma.$disconnect();
});

function input(n: string, extra: Record<string, unknown> = {}) {
  const slug = `st-${n}-${tag}`;
  const email = `dono-${n}-${tag}@t.local`;
  slugs.push(slug);
  emails.push(email);
  return { ownerName: "Dono", email, password: PW, storeName: "Loja Teste", slug, planId, ...extra } as Parameters<typeof createStore>[0];
}

describe("createStore", () => {
  it("cria conta, loja em trial de 14 dias, membro OWNER, assinatura e settings", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const { store, account } = await createStore(input("a"), { db: prisma, now: () => now });
    expect(store.status).toBe("TRIAL");
    expect(store.trialEndsAt!.getTime()).toBe(now.getTime() + 14 * 86400_000);
    expect(await bcrypt.compare(PW, account.passwordHash)).toBe(true);
    expect(await prisma.storeMember.findUnique({ where: { storeId_accountId: { storeId: store.id, accountId: account.id } } })).toMatchObject({ role: "OWNER" });
    expect(await prisma.subscription.findUnique({ where: { storeId: store.id } })).toMatchObject({ status: "TRIALING" });
    const s = await prisma.storeSetting.findMany({ where: { storeId: store.id } });
    expect(Object.fromEntries(s.map((x) => [x.key, x.value]))).toEqual({ originCep: "37175000", pixDiscountPercent: "0" });
  });

  it("deriva slug do nome quando nao informado", async () => {
    const i = input("b", { slug: undefined, storeName: `Ótima ${tag}` });
    slugs.push(`otima-${tag}`);
    const { store } = await createStore(i, { db: prisma });
    expect(store.slug).toBe(`otima-${tag}`);
  });

  it("slug invalido, reservado ou derivado vazio -> SlugInvalidError", async () => {
    for (const slug of ["www", "admin", "a.b", "Maiuscula", "-x", "x".repeat(41)]) {
      await expect(createStore(input("c", { slug }), { db: prisma })).rejects.toBeInstanceOf(SlugInvalidError);
    }
    await expect(createStore(input("c", { slug: undefined, storeName: "!!" }), { db: prisma })).rejects.toBeInstanceOf(SlugInvalidError);
  });

  it("email repetido -> EmailExistsError; slug repetido -> SlugTakenError", async () => {
    const i = input("d");
    await createStore(i, { db: prisma });
    await expect(createStore({ ...input("e"), email: i.email }, { db: prisma })).rejects.toBeInstanceOf(EmailExistsError);
    await expect(createStore({ ...input("f"), slug: i.slug }, { db: prisma })).rejects.toBeInstanceOf(SlugTakenError);
    expect(await prisma.account.count({ where: { email: { in: emails } } })).toBe(1);
  });

  it("email com caixa diferente conta como repetido", async () => {
    const i = input("g");
    await createStore(i, { db: prisma });
    await expect(createStore({ ...input("h"), email: ` ${i.email.toUpperCase()} ` }, { db: prisma })).rejects.toBeInstanceOf(EmailExistsError);
  });

  it("concorrencia no mesmo slug: um vence, o outro SlugTakenError, sem orfaos", async () => {
    const a = input("i");
    const b = { ...input("j"), slug: a.slug };
    const r = await Promise.allSettled([createStore(a, { db: prisma }), createStore(b, { db: prisma })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(SlugTakenError);
    expect(await prisma.store.count({ where: { slug: a.slug } })).toBe(1);
    expect(await prisma.account.count({ where: { email: { in: emails } } })).toBe(1);
  });

  it("concorrencia no mesmo email -> EmailExistsError", async () => {
    const a = input("k");
    const b = { ...input("l"), email: a.email };
    const r = await Promise.allSettled([createStore(a, { db: prisma }), createStore(b, { db: prisma })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(EmailExistsError);
    expect(await prisma.store.count({ where: { slug: { in: slugs } } })).toBe(1);
  });

  it("plano inativo ou inexistente -> PlanNotFoundError, sem linhas", async () => {
    await prisma.plan.update({ where: { id: planId }, data: { active: false } });
    const i = input("m");
    await expect(createStore(i, { db: prisma })).rejects.toBeInstanceOf(PlanNotFoundError);
    await prisma.plan.update({ where: { id: planId }, data: { active: true } });
    await expect(createStore({ ...i, planId: "nao-existe" }, { db: prisma })).rejects.toBeInstanceOf(PlanNotFoundError);
    expect(await prisma.account.count({ where: { email: i.email } })).toBe(0);
  });
});

describe("isSlugAvailable", () => {
  it("false para invalido, reservado e existente", async () => {
    const i = input("n");
    expect(await isSlugAvailable(i.slug!)).toBe(true);
    await createStore(i, { db: prisma });
    expect(await isSlugAvailable(i.slug!)).toBe(false);
    expect(await isSlugAvailable("app")).toBe(false);
    expect(await isSlugAvailable("a.b")).toBe(false);
    expect(await isSlugAvailable("")).toBe(false);
  });
});

describe("POST /api/signup", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    POST(new Request("http://localhost/api/signup", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-forwarded-for": `10.3.${Math.random()}`, ...headers }, body: JSON.stringify(body) })); // IP novo: fora do limite de cadastros

  it("201 sem hash; 409 para email e slug repetidos; 400 invalido", async () => {
    const i = input("o");
    const res = await post(i);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.slug).toBe(i.slug);
    expect(json.storeUrl).toContain(`${i.slug}.`);
    expect(JSON.stringify(json)).not.toMatch(/hash|\$2/i);

    const dupEmail = await post({ ...input("p"), email: i.email });
    expect(dupEmail.status).toBe(409);
    expect((await dupEmail.json()).error).toBe("EMAIL_EXISTS");
    expect((await post({ ...input("q"), slug: i.slug })).status).toBe(409);
    expect((await post({ ...input("r"), slug: "www" })).status).toBe(400);
    expect((await post({ ...input("s"), password: "curta" })).status).toBe(400);
    expect((await post({ ...input("t"), planId: "nao-existe" })).status).toBe(400);
  });

  it("404 em host de loja", async () => {
    expect((await post(input("u"), { "x-store-host": "demo.localhost" })).status).toBe(404);
  });
});
