import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { seed } from "../prisma/seed";

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });

let storeId: string;
let productId: string;

beforeAll(async () => {
  process.env.SEED_MASTER_EMAIL = "master@test.local";
  process.env.SEED_MASTER_PASSWORD = "senha-teste-123";
  await seed(prisma);
  storeId = (await prisma.store.findUniqueOrThrow({ where: { slug: "demo" } })).id;
  productId = (await prisma.product.findFirstOrThrow({ where: { storeId } })).id;
});
afterAll(() => prisma.$disconnect());

const variant = (over: object = {}) => ({
  storeId,
  productId,
  sku: "X-1",
  color: "Roxo",
  size: "ZZ",
  priceCents: 1000,
  stock: 1,
  ...over,
});

describe("seed", () => {
  it("roda duas vezes e gera contagens esperadas", async () => {
    await seed(prisma);
    expect(await prisma.account.count({ where: { isMaster: true } })).toBe(1);
    expect(await prisma.plan.count()).toBe(3);
    expect(await prisma.store.count({ where: { slug: "demo" } })).toBe(1);
    expect(await prisma.category.count({ where: { storeId } })).toBe(2);
    expect(await prisma.product.count({ where: { storeId } })).toBe(3);
    expect(await prisma.variant.count({ where: { storeId } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.storeSetting.count({ where: { storeId } })).toBe(2);
    const biz = await prisma.plan.findFirstOrThrow({ where: { name: "Business" } });
    expect(biz).toMatchObject({ priceCents: 34900, productLimit: null, staffLimit: 15, csvExport: true });
  });
});

describe("constraints", () => {
  it("rejeita estoque negativo (CHECK)", async () => {
    await expect(prisma.variant.create({ data: variant({ stock: -1 }) })).rejects.toThrow(/check constraint|Variant_stock_nonneg/);
  });
  it("unique (productId,color,size) e (storeId,sku)", async () => {
    await prisma.variant.create({ data: variant() });
    await expect(prisma.variant.create({ data: variant({ sku: "X-2" }) })).rejects.toThrow(/Unique/);
    await expect(prisma.variant.create({ data: variant({ size: "YY" }) })).rejects.toThrow(/Unique/);
    await prisma.variant.deleteMany({ where: { sku: "X-1" } });
  });
  it("slug de categoria unico por loja, repetivel entre lojas", async () => {
    const plan = await prisma.plan.findFirstOrThrow();
    const other = await prisma.store.create({ data: { slug: "outra", name: "Outra", planId: plan.id } });
    const slug = (await prisma.category.findFirstOrThrow({ where: { storeId } })).slug;
    await prisma.category.create({ data: { storeId: other.id, slug, name: "Mesma" } });
    await expect(prisma.category.create({ data: { storeId, slug, name: "Dup" } })).rejects.toThrow(/Unique/);
    await prisma.store.delete({ where: { id: other.id } });
  });
});
