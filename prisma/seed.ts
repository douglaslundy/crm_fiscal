import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "node:url";

const PLANS = [
  { name: "Start", priceCents: 4900, productLimit: 50, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  { name: "Pro", priceCents: 12900, productLimit: 500, staffLimit: 5, customDomain: true, advancedMetrics: true, csvExport: false },
  { name: "Business", priceCents: 34900, productLimit: null, staffLimit: 15, customDomain: true, advancedMetrics: true, csvExport: true },
];

const CATEGORIES = [
  { slug: "camisetas", name: "Camisetas" },
  { slug: "calcas", name: "Calças" },
];

const PRODUCTS = [
  { slug: "camiseta-basica", name: "Camiseta Básica", category: "camisetas", price: 5990 },
  { slug: "camiseta-estampada", name: "Camiseta Estampada", category: "camisetas", price: 7990 },
  { slug: "calca-jeans", name: "Calça Jeans", category: "calcas", price: 15990 },
];

const VARIATIONS = [
  { color: "Preto", size: "M" },
  { color: "Preto", size: "G" },
  { color: "Branco", size: "M" },
];

export async function seed(prisma: PrismaClient) {
  const email = process.env.SEED_MASTER_EMAIL;
  const password = process.env.SEED_MASTER_PASSWORD;
  if (!email || !password) throw new Error("Defina SEED_MASTER_EMAIL e SEED_MASTER_PASSWORD");

  // Idempotente: nao regrava o hash se a conta ja existe (bcrypt gera salt novo a cada chamada).
  await prisma.account.upsert({
    where: { email },
    update: { isMaster: true },
    create: { email, name: "Master", isMaster: true, passwordHash: await bcrypt.hash(password, 10) },
  });

  // Sobrescreve valores do plano de proposito: planos sao canonicos ate existir a UI do master.
  for (const p of PLANS) {
    await prisma.plan.upsert({ where: { name: p.name }, update: p, create: p });
  }
  const plan = await prisma.plan.findUniqueOrThrow({ where: { name: "Start" } });

  const store = await prisma.store.upsert({
    where: { slug: "demo" },
    update: {},
    create: { slug: "demo", name: "Loja Demo", status: "ACTIVE", planId: plan.id },
  });
  const storeId = store.id;

  const cats: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { storeId_slug: { storeId, slug: c.slug } },
      update: {},
      create: { storeId, ...c },
    });
    cats[c.slug] = row.id;
  }

  for (const p of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { storeId_slug: { storeId, slug: p.slug } },
      update: {},
      create: {
        storeId,
        slug: p.slug,
        name: p.name,
        categoryId: cats[p.category],
        weightGrams: 300,
        heightCm: 3,
        widthCm: 25,
        lengthCm: 30,
      },
    });
    for (const [i, v] of VARIATIONS.entries()) {
      const sku = `${p.slug}-${v.color}-${v.size}`.toUpperCase();
      await prisma.variant.upsert({
        where: { storeId_sku: { storeId, sku } },
        update: {},
        create: { storeId, productId: product.id, sku, ...v, priceCents: p.price, stock: 10 + i },
      });
    }
  }

  for (const [key, value] of [["originCep", "37175000"], ["pixDiscountPercent", "0"]]) {
    await prisma.storeSetting.upsert({
      where: { storeId_key: { storeId, key } },
      update: {},
      create: { storeId, key, value },
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log("seed ok"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
