import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
    process.env.SEED_MASTER_EMAIL = "  Master@Test.LOCAL "; // normalizado: mesma conta, login funciona
    await seed(prisma);
    process.env.SEED_MASTER_EMAIL = "master@test.local";
    expect(await prisma.account.count({ where: { isMaster: true } })).toBe(1);
    expect(await prisma.account.findUnique({ where: { email: "master@test.local" } })).not.toBeNull();
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

describe("seed em producao (SEED_DEMO=0)", () => {
  it("cria master e planos sem criar loja", async () => {
    const stores = await prisma.store.count();
    process.env.SEED_DEMO = "0";
    process.env.SEED_MASTER_EMAIL = "prod-master@test.local";
    try {
      await seed(prisma);
      expect(await prisma.account.findUnique({ where: { email: "prod-master@test.local" } })).toMatchObject({ isMaster: true });
      expect(await prisma.store.count()).toBe(stores);
    } finally {
      delete process.env.SEED_DEMO;
      process.env.SEED_MASTER_EMAIL = "master@test.local";
      await prisma.account.deleteMany({ where: { email: "prod-master@test.local" } });
    }
  });
});

const FK = /Foreign key constraint|violates foreign key/i;

let planId: string;
const created: string[] = []; // lojas extras, removidas em afterEach mesmo se o teste falhar

async function newStore(slug: string) {
  planId ??= (await prisma.plan.findFirstOrThrow()).id;
  const st = await prisma.store.create({ data: { slug, name: slug, planId } });
  created.push(st.id);
  return st.id;
}

afterEach(async () => {
  await prisma.order.deleteMany({ where: { storeId } }); // cascata remove itens
  await prisma.customer.deleteMany({ where: { storeId } });
  await prisma.variant.deleteMany({ where: { sku: "X-1" } });
  await prisma.store.deleteMany({ where: { id: { in: created.splice(0) } } });
});

describe("constraints", () => {
  it("rejeita estoque negativo (CHECK)", async () => {
    await expect(prisma.variant.create({ data: variant({ stock: -1 }) })).rejects.toThrow(/check constraint|Variant_stock_nonneg/);
  });
  it("unique (productId,color,size) e (storeId,sku)", async () => {
    await prisma.variant.create({ data: variant() });
    await expect(prisma.variant.create({ data: variant({ sku: "X-2" }) })).rejects.toThrow(/Unique/);
    await expect(prisma.variant.create({ data: variant({ size: "YY" }) })).rejects.toThrow(/Unique/);
  });
  it("slug de categoria unico por loja, repetivel entre lojas", async () => {
    const other = await newStore("outra");
    const slug = (await prisma.category.findFirstOrThrow({ where: { storeId } })).slug;
    await prisma.category.create({ data: { storeId: other, slug, name: "Mesma" } });
    await expect(prisma.category.create({ data: { storeId, slug, name: "Dup" } })).rejects.toThrow(/Unique/);
  });
});

describe("isolamento entre lojas (FK composta)", () => {
  const cust = (sid: string, email: string) =>
    prisma.customer.create({ data: { storeId: sid, name: "C", email, cpf: "1", phone: "1", passwordHash: "x" } });
  const ord = (sid: string, customerId: string) =>
    prisma.order.create({
      data: { storeId: sid, customerId, subtotalCents: 1, shippingCents: 0, totalCents: 1, shippingService: "PAC", addressSnapshot: {} },
    });

  it("Variant de B nao aponta para Product de A", async () => {
    const b = await newStore("loja-b");
    await expect(prisma.variant.create({ data: variant({ storeId: b }) })).rejects.toThrow(FK);
  });
  it("Product de B nao aponta para Category de A", async () => {
    const b = await newStore("loja-b");
    const categoryId = (await prisma.category.findFirstOrThrow({ where: { storeId } })).id;
    await expect(
      prisma.product.create({ data: { storeId: b, categoryId, slug: "p", name: "p", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 } }),
    ).rejects.toThrow(FK);
  });
  it("Order de B nao aponta para Customer de A", async () => {
    const b = await newStore("loja-b");
    const c = await cust(storeId, "a@x.com");
    await expect(ord(b, c.id)).rejects.toThrow(FK);
  });
  it("OrderItem de B nao aponta para Order nem Variant de A", async () => {
    const b = await newStore("loja-b");
    const ca = await cust(storeId, "a2@x.com");
    const oa = await ord(storeId, ca.id);
    const cb = await cust(b, "b@x.com");
    const ob = await ord(b, cb.id);
    const va = await prisma.variant.findFirstOrThrow({ where: { storeId } });
    const item = { productName: "p", sku: "s", color: "c", size: "s", unitPriceCents: 1, quantity: 1 };
    await expect(prisma.orderItem.create({ data: { ...item, storeId: b, orderId: oa.id } })).rejects.toThrow(FK);
    await expect(prisma.orderItem.create({ data: { ...item, storeId: b, orderId: ob.id, variantId: va.id } })).rejects.toThrow(FK);
  });
  it("caso positivo + delete da loja em cascata sem sobras", async () => {
    const s = await newStore("cascata");
    const cat = await prisma.category.create({ data: { storeId: s, slug: "c", name: "c" } });
    const prod = await prisma.product.create({
      data: { storeId: s, categoryId: cat.id, slug: "p", name: "p", weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 },
    });
    const v = await prisma.variant.create({ data: variant({ storeId: s, productId: prod.id, sku: "C-1" }) });
    const c = await cust(s, "c@x.com");
    const o = await ord(s, c.id);
    await prisma.orderItem.create({
      data: { storeId: s, orderId: o.id, variantId: v.id, productName: "p", sku: "C-1", color: "Roxo", size: "ZZ", unitPriceCents: 1, quantity: 1 },
    });
    await prisma.store.delete({ where: { id: s } });
    for (const m of [prisma.category, prisma.product, prisma.variant, prisma.customer, prisma.order, prisma.orderItem] as { count: (a: object) => Promise<number> }[]) {
      expect(await m.count({ where: { storeId: s } })).toBe(0);
    }
  });
});
