import type { OrderStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { productJsonLd } from "./catalog";
import {
  ReviewBody, ReviewError, createReview, deleteReview, getProductReviews, hasPurchased, listReviewsAdmin, reviewEligibility, setReviewHidden,
} from "./reviews";

let tag: string;
let planId: string;
const stores: string[] = [];
let S: string;
let product: string;
let variant: string;

const mkStore = async (k: string) => {
  const s = await prisma.store.create({ data: { slug: `rev-${k}-${tag}`, name: `Loja ${k}`, planId } });
  stores.push(s.id);
  return s.id;
};
async function mkProduct(storeId: string, k: string) {
  const p = await prisma.product.create({ data: { storeId, slug: `p-${k}-${tag}`, name: `Prod ${k}`, weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  const v = await prisma.variant.create({ data: { storeId, productId: p.id, sku: `S-${k}-${tag}`, color: "Azul", size: "G", priceCents: 5000, stock: 5 } });
  return { product: p.id, variant: v.id };
}
const mkCustomer = async (storeId: string, k: string, name = `Cli ${k}`) =>
  (await prisma.customer.create({ data: { storeId, name, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
async function buy(storeId: string, customerId: string, variantId: string, status: OrderStatus = "PAID") {
  const o = await prisma.order.create({ data: { storeId, customerId, status, subtotalCents: 5000, shippingCents: 0, totalCents: 5000, shippingService: "PAC", addressSnapshot: {} } });
  await prisma.orderItem.create({ data: { storeId, orderId: o.id, variantId, productName: "P", sku: "S", color: "Azul", size: "G", unitPriceCents: 5000, quantity: 1 } });
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof ReviewError ? e.code : String(e)));
const body = (o: Partial<{ rating: number; comment: string }> = {}) => ReviewBody.parse({ productId: product, rating: 5, ...o });

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Rev" }, update: {},
    create: { name: "Teste-Rev", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  S = await mkStore("s");
  ({ product, variant } = await mkProduct(S, "a"));
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Rev" } });
  await prisma.$disconnect();
});

describe("quem pode avaliar", () => {
  it("so com pedido pago/enviado/entregue com o produto; pendente e cancelado nao", async () => {
    for (const [i, st] of (["PENDING_PAYMENT", "CANCELED"] as OrderStatus[]).entries()) {
      const c = await mkCustomer(S, `n${i}`);
      await buy(S, c, variant, st);
      expect(await hasPurchased(S, c, product), st).toBe(false);
      expect(await code(createReview(S, c, body()))).toBe("NOT_PURCHASER");
    }
    for (const [i, st] of (["PAID", "SHIPPED", "DELIVERED"] as OrderStatus[]).entries()) {
      const c = await mkCustomer(S, `y${i}`);
      await buy(S, c, variant, st);
      expect(await reviewEligibility(S, c, product), st).toBe("CAN_REVIEW");
    }
    expect(await reviewEligibility(S, await mkCustomer(S, "nunca"), product)).toBe("NOT_PURCHASER");
  });
  it("comprou outro produto nao avalia este; produto de outra loja ou inexistente 404", async () => {
    const other = await mkProduct(S, "b");
    const c = await mkCustomer(S, "c");
    await buy(S, c, other.variant);
    expect(await code(createReview(S, c, body()))).toBe("NOT_PURCHASER");
    const foreign = await mkProduct(await mkStore("f"), "f");
    expect(await code(createReview(S, c, ReviewBody.parse({ productId: foreign.product, rating: 5 })))).toBe("PRODUCT_NOT_FOUND");
    expect(await code(createReview(S, c, ReviewBody.parse({ productId: "nao-existe", rating: 5 })))).toBe("PRODUCT_NOT_FOUND");
  });
  it("uma avaliacao por cliente e produto, mesmo em disputa concorrente", async () => {
    const c = await mkCustomer(S, "c");
    await buy(S, c, variant);
    const results = await Promise.all([1, 2, 3].map(() => code(createReview(S, c, body()))));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "ALREADY_REVIEWED")).toHaveLength(2);
    expect(await reviewEligibility(S, c, product)).toBe("ALREADY_REVIEWED");
  });
});

describe("vitrine e moderacao", () => {
  it("media, contagem, so primeiro nome; oculta sai da vitrine e da media; excluir; isolamento", async () => {
    const [a, b] = [await mkCustomer(S, "a", "Ana Maria Souza"), await mkCustomer(S, "b", "Bruno")];
    await buy(S, a, variant);
    await buy(S, b, variant);
    const ra = await createReview(S, a, body({ rating: 5, comment: "  ótima  " }));
    await createReview(S, b, body({ rating: 2 }));
    const r = await getProductReviews(S, product);
    expect([r.count, r.average]).toEqual([2, 3.5]);
    expect(r.items.map((i) => i.author).sort()).toEqual(["Ana", "Bruno"]);
    expect(JSON.stringify(r)).not.toMatch(/Souza|@t\.local/);
    expect(r.items.find((i) => i.author === "Ana")?.comment).toBe("ótima");
    await setReviewHidden(S, ra.id, true);
    expect(await getProductReviews(S, product)).toMatchObject({ count: 1, average: 2 });
    expect((await listReviewsAdmin(S)).total).toBe(2); // admin ainda ve a oculta
    const other = await mkStore("o");
    expect(await code(setReviewHidden(other, ra.id, false))).toBe("REVIEW_NOT_FOUND");
    expect(await code(deleteReview(other, ra.id))).toBe("REVIEW_NOT_FOUND");
    expect(await code(deleteReview(S, ra.id))).toBe("ok");
    expect(await code(deleteReview(S, ra.id))).toBe("REVIEW_NOT_FOUND");
    expect(await getProductReviews(other, product)).toMatchObject({ count: 0, average: null, items: [] });
  });
  it("sem avaliacao: media nula; JSON-LD so traz aggregateRating com avaliacoes", () => {
    const p = { name: "P", description: "d", images: [], variants: [{ priceCents: 100, stock: 1 }] };
    expect(productJsonLd(p, { average: null, count: 0 })).not.toHaveProperty("aggregateRating");
    expect(productJsonLd(p, { average: 4.5, count: 2 })).toMatchObject({ aggregateRating: { ratingValue: 4.5, reviewCount: 2 } });
  });
  it("excluir o produto apaga as avaliacoes dele", async () => {
    const c = await mkCustomer(S, "c");
    await buy(S, c, variant);
    await createReview(S, c, body());
    await prisma.orderItem.deleteMany({ where: { storeId: S } });
    await prisma.variant.deleteMany({ where: { productId: product } });
    await prisma.product.delete({ where: { id: product } });
    expect(await prisma.review.count({ where: { storeId: S } })).toBe(0);
  });
});

describe("schema", () => {
  it("nota 1-5 inteira; comentario ate 1000; comentario vazio permitido", () => {
    for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 3.5 }, { rating: 5, comment: "x".repeat(1001) }]) {
      expect(ReviewBody.safeParse({ productId: "p", ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ReviewBody.parse({ productId: "p", rating: 5 }).comment).toBe("");
  });
});
