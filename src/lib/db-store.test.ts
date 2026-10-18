import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dbForStore, STORE_MODELS } from "./db-store";

let A: string;
let B: string;
let prodA: string;
let prodB: string;
const stores: string[] = [];

const product = (storeId: string, slug: string) => ({
  storeId,
  slug,
  name: slug,
  weightGrams: 1,
  heightCm: 1,
  widthCm: 1,
  lengthCm: 1,
});

beforeEach(async () => {
  const planId = (await prisma.plan.upsert({
    where: { name: "Teste-Escopo" },
    update: {},
    create: { name: "Teste-Escopo", priceCents: 0, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  const tag = Math.random().toString(36).slice(2, 8);
  A = (await prisma.store.create({ data: { slug: `esc-a-${tag}`, name: "A", planId } })).id;
  B = (await prisma.store.create({ data: { slug: `esc-b-${tag}`, name: "B", planId } })).id;
  stores.push(A, B);
  prodA = (await prisma.product.create({ data: product(A, "pa") })).id;
  prodB = (await prisma.product.create({ data: product(B, "pb") })).id;
});

afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } }); // cascata
});
afterAll(() => prisma.$disconnect());

describe("dbForStore: leitura", () => {
  it("findMany nao devolve produto de outra loja", async () => {
    const ids = (await dbForStore(A).product.findMany()).map((p) => p.id);
    expect(ids).toEqual([prodA]);
  });
  it("findMany com where explicito de outra loja nao escapa", async () => {
    expect(await dbForStore(A).product.findMany({ where: { storeId: B } })).toEqual([]);
    expect(await dbForStore(A).product.findMany({ where: { OR: [{ storeId: B }, { id: prodB }] } })).toEqual([]);
  });
  it("findUnique/findFirst por id de outra loja -> null; OrThrow lanca", async () => {
    expect(await dbForStore(A).product.findUnique({ where: { id: prodB } })).toBeNull();
    expect(await dbForStore(A).product.findFirst({ where: { id: prodB } })).toBeNull();
    expect(await dbForStore(A).product.findUnique({ where: { storeId_slug: { storeId: B, slug: "pb" } } })).toBeNull();
    await expect(dbForStore(A).product.findUniqueOrThrow({ where: { id: prodB } })).rejects.toThrow();
    await expect(dbForStore(A).product.findFirstOrThrow({ where: { id: prodB } })).rejects.toThrow();
    expect((await dbForStore(A).product.findUnique({ where: { id: prodA } }))?.id).toBe(prodA);
    expect((await dbForStore(A).product.findUniqueOrThrow({ where: { id: prodA } })).id).toBe(prodA);
    expect((await dbForStore(A).product.findFirstOrThrow({ where: { id: prodA } })).id).toBe(prodA);
  });
  it("count, aggregate e groupBy so veem a propria loja", async () => {
    await prisma.product.create({ data: product(B, "pb2") });
    expect(await dbForStore(A).product.count()).toBe(1);
    expect(await dbForStore(B).product.count()).toBe(2);
    const agg = await dbForStore(A).product.aggregate({ _count: { _all: true }, _sum: { weightGrams: true } });
    expect(agg._count._all).toBe(1);
    expect(agg._sum.weightGrams).toBe(1);
    const g = await dbForStore(B).product.groupBy({ by: ["storeId"], _count: { _all: true } });
    expect(g).toEqual([{ storeId: B, _count: { _all: 2 } }]);
  });
});

describe("dbForStore: escrita", () => {
  it("create injeta storeId (tipos exigem storeId; em runtime e injetado)", async () => {
    const data = { ...product(A, "novo"), storeId: undefined as unknown as string };
    const p = await dbForStore(A).product.create({ data });
    expect(p.storeId).toBe(A);
  });
  it("create com storeId de outra loja lanca", async () => {
    await expect(dbForStore(A).product.create({ data: product(B, "x") })).rejects.toThrow(/outra loja/);
    expect(await prisma.product.count({ where: { slug: "x" } })).toBe(0);
  });
  it("createMany e createManyAndReturn escopados", async () => {
    const data = product(A, "m1");
    await dbForStore(A).product.createMany({ data: [data, { ...data, slug: "m2" }] });
    expect(await prisma.product.count({ where: { storeId: A } })).toBe(3);
    const r = await dbForStore(A).product.createManyAndReturn({ data: { ...data, slug: "m3" } });
    expect(r[0].storeId).toBe(A);
    await expect(dbForStore(A).product.createMany({ data: [data, product(B, "m4")] })).rejects.toThrow(/outra loja/);
  });
  it("updateMany/deleteMany com id de outra loja afetam 0 linhas", async () => {
    expect(await dbForStore(A).product.updateMany({ where: { id: prodB }, data: { name: "hack" } })).toEqual({ count: 0 });
    expect(await dbForStore(A).product.deleteMany({ where: { id: prodB } })).toEqual({ count: 0 });
    expect(await dbForStore(A).product.deleteMany({ where: { storeId: B } })).toEqual({ count: 0 });
    const b = await prisma.product.findUniqueOrThrow({ where: { id: prodB } });
    expect(b.name).toBe("pb");
  });
  it("update/delete por id de outra loja lancam e nao alteram", async () => {
    await expect(dbForStore(A).product.update({ where: { id: prodB }, data: { name: "hack" } })).rejects.toThrow();
    await expect(dbForStore(A).product.delete({ where: { id: prodB } })).rejects.toThrow();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: prodB } })).name).toBe("pb");
    expect((await dbForStore(A).product.update({ where: { id: prodA }, data: { name: "ok" } })).name).toBe("ok");
    await dbForStore(A).product.delete({ where: { id: prodA } });
    expect(await prisma.product.count({ where: { storeId: A } })).toBe(0);
  });
  it("update nao move a linha para outra loja", async () => {
    await expect(dbForStore(A).product.update({ where: { id: prodA }, data: { storeId: B } })).rejects.toThrow(/outra loja/);
    await expect(dbForStore(A).product.updateMany({ data: { storeId: B } })).rejects.toThrow(/outra loja/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: prodA } })).storeId).toBe(A);
  });
  it("upsert escopa where e create", async () => {
    await expect(
      dbForStore(A).product.upsert({ where: { id: prodB }, update: { name: "hack" }, create: product(B, "up") }),
    ).rejects.toThrow(/outra loja/);
    const data = product(A, "up");
    // id de B nao casa no escopo de A: cai no create (que falha por id duplicado), nunca atualiza B
    await expect(dbForStore(A).product.upsert({ where: { id: prodB }, update: { name: "hack" }, create: { ...data, id: prodB } })).rejects.toThrow();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: prodB } })).name).toBe("pb");
    const up = await dbForStore(A).product.upsert({ where: { id: prodA }, update: { name: "ok" }, create: data });
    expect(up).toMatchObject({ id: prodA, name: "ok" });
  });
  it("rejeita escrita aninhada em relacoes", async () => {
    const data = product(A, "n1");
    await expect(
      dbForStore(A).product.create({
        data: { ...data, variants: { create: [{ sku: "S", color: "c", size: "s", priceCents: 1, storeId: B }] } },
      } as never),
    ).rejects.toThrow(/aninhada/);
    await expect(
      dbForStore(A).product.update({ where: { id: prodA }, data: { store: { connect: { id: B } } } } as never),
    ).rejects.toThrow(/aninhada/);
  });
  it("rejeita acesso a relacao store (porta para dados da plataforma)", async () => {
    await expect(dbForStore(A).product.findMany({ include: { store: true } })).rejects.toThrow(/store/);
    await expect(
      dbForStore(A).variant.findMany({ include: { product: { select: { store: true } } } }),
    ).rejects.toThrow(/store/);
    await expect(dbForStore(A).product.findMany({ where: { store: { slug: "x" } } })).rejects.toThrow(/store/);
  });
});

describe("dbForStore: superficie", () => {
  it("nao expoe modelos de plataforma nem SQL bruto", () => {
    const db = dbForStore(A) as unknown as Record<string, unknown>;
    for (const k of ["account", "store", "storeMember", "storeDomain", "plan", "subscription", "$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe", "$extends"]) {
      expect(db[k], k).toBeUndefined();
    }
  });
  it("$transaction interativo continua escopado", async () => {
    const ids = await dbForStore(A).$transaction(async (tx) => {
      expect((tx as unknown as Record<string, unknown>).account).toBeUndefined();
      return (await tx.product.findMany()).map((p) => p.id);
    });
    expect(ids).toEqual([prodA]);
  });
  it("todo modelo com storeId esta na lista escopada e vice-versa (DMMF)", () => {
    const withStoreId = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === "storeId"))
      .map((m) => m.name);
    const platform = ["StoreMember", "StoreDomain", "Subscription"]; // tem storeId mas sao da plataforma
    expect(withStoreId.filter((n) => !platform.includes(n)).sort()).toEqual([...STORE_MODELS].sort());
    const all = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(all.filter((n) => !STORE_MODELS.includes(n as never) && !platform.includes(n)).sort()).toEqual(["Account", "Plan", "Store"]);
  });
});
