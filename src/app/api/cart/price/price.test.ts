import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
const nextHeaders = await import("next/headers");
const { POST } = await import("./route");

let tag: string;
let A: { id: string; slug: string };
let B: { id: string; slug: string };
const stores: string[] = [];
const ids: Record<string, string> = {};

async function seed(storeId: string, k: string, o: { stock?: number; active?: boolean; productActive?: boolean; price?: number } = {}) {
  const p = await prisma.product.create({
    data: { storeId, slug: `p-${k}-${tag}`, name: `Prod ${k}`, weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1, active: o.productActive ?? true },
  });
  await prisma.productImage.create({ data: { storeId, productId: p.id, url: `https://img/${k}.png`, color: null } });
  const v = await prisma.variant.create({
    data: { storeId, productId: p.id, sku: `sku-${k}-${tag}`, color: "Preto", size: "M", priceCents: o.price ?? 5000, stock: o.stock ?? 10, active: o.active ?? true },
  });
  return (ids[k] = v.id);
}

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  const planId = (await prisma.plan.upsert({
    where: { name: "Teste-Cart" }, update: {},
    create: { name: "Teste-Cart", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = await prisma.store.create({ data: { slug: `cart-a-${tag}`, name: "A", planId } });
  B = await prisma.store.create({ data: { slug: `cart-b-${tag}`, name: "B", planId } });
  stores.push(A.id, B.id);
});
afterEach(async () => {
  vi.mocked(nextHeaders.headers).mockReset();
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Cart" } });
  await prisma.$disconnect();
});

const call = (s: { slug: string }, body: unknown, extra: Record<string, string> = {}) => {
  const h = { "content-type": "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: `${s.slug}.localhost`, ...extra };
  vi.mocked(nextHeaders.headers).mockResolvedValue(new Headers(h) as never);
  return POST(new Request("http://localhost/api/cart/price", { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) }));
};

describe("POST /api/cart/price", () => {
  it("preco e estoque vem do banco; campos extras do corpo sao ignorados", async () => {
    const a = await seed(A.id, "a", { price: 7000 });
    const res = await call(A, { lines: [{ variantId: a, qty: 2, priceCents: 1, price: 1 }], price: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lines: [{ variantId: a, productName: "Prod a", color: "Preto", size: "M", qty: 2, unitCents: 7000, lineCents: 14000, imageUrl: "https://img/a.png" }],
      subtotalCents: 14000,
      issues: [],
    });
  });
  it("variacao de outra loja -> INACTIVE, sem dados da outra loja", async () => {
    const b = await seed(B.id, "b");
    const res = await call(A, { lines: [{ variantId: b, qty: 1 }] });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ lines: [], subtotalCents: 0, issues: [{ variantId: b, kind: "INACTIVE", available: 0 }] });
    expect(text).not.toMatch(/Prod b/);
  });
  it("produto inativo, estoque curto e esgotado", async () => {
    const p = await seed(A.id, "p", { productActive: false });
    const q = await seed(A.id, "q", { stock: 2 });
    const o = await seed(A.id, "o", { stock: 0 });
    const body = await (await call(A, { lines: [{ variantId: p, qty: 1 }, { variantId: q, qty: 5 }, { variantId: o, qty: 1 }] })).json();
    expect(body.issues).toEqual([
      { variantId: p, kind: "INACTIVE", available: 0 },
      { variantId: q, kind: "QTY_REDUCED", available: 2 },
      { variantId: o, kind: "OUT_OF_STOCK", available: 0 },
    ]);
    expect(body.lines.map((l: { qty: number }) => l.qty)).toEqual([2]);
  });
  it("loja suspensa ou cancelada -> 403 STORE_UNAVAILABLE", async () => {
    const a = await seed(A.id, "a");
    for (const status of ["SUSPENDED", "CANCELED"] as const) {
      await prisma.store.update({ where: { id: A.id }, data: { status } });
      const res = await call(A, { lines: [{ variantId: a, qty: 1 }] });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "STORE_UNAVAILABLE" });
    }
  });
  it("origem cruzada -> 403", async () => {
    expect((await call(A, { lines: [] }, { origin: "http://evil.example" })).status).toBe(403);
  });
  it("corpo invalido -> 400", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ variantId: `v${i}`, qty: 1 }));
    for (const b of ["nao json", {}, { lines: "x" }, { lines: [{ variantId: 1, qty: 1 }] }, { lines: [{ variantId: "a".repeat(65), qty: 1 }] }, { lines: [{ variantId: "a" }] }, { lines: many }]) {
      expect((await call(A, b)).status, JSON.stringify(b).slice(0, 40)).toBe(400);
    }
  });
  it("corpo acima de 16 KB -> 413", async () => {
    expect((await call(A, JSON.stringify({ lines: [], pad: "x".repeat(17_000) }))).status).toBe(413);
  });
  it("429 apos 60 consultas por minuto do mesmo IP na loja; outra loja segue", async () => {
    const ip = { "x-forwarded-for": `10.1.0.${tag}` };
    for (let i = 0; i < 60; i++) expect((await call(A, { lines: [] }, ip)).status).toBe(200);
    const res = await call(A, { lines: [] }, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await call(B, { lines: [] }, ip)).status).toBe(200);
  });
  it("carrinho vazio -> 200 vazio", async () => {
    expect(await (await call(A, { lines: [] })).json()).toEqual({ lines: [], subtotalCents: 0, issues: [] });
  });
});
