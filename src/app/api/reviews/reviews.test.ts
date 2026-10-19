import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ getSession }));

import { afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

let tag: string;
let planId: string;
let storeId: string;
let host: string;
let productId: string;
let buyer: string;
let stranger: string;

const customerSession = (id: string, sid = storeId) => ({ user: { id, kind: "customer", storeId: sid }, expires: "2099-01-01" });
const send = (body: unknown, o: { origin?: string } = {}) =>
  POST(new Request("http://localhost/api/reviews", {
    method: "POST", headers: { "content-type": "application/json", origin: o.origin ?? "http://localhost", "x-store-host": host }, body: JSON.stringify(body),
  }));

beforeAll(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  process.env.PLATFORM_DOMAIN = "plataforma.test";
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-RevApi" }, update: {},
    create: { name: "Teste-RevApi", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  storeId = (await prisma.store.create({ data: { slug: `rev-${tag}`, name: "L", planId, status: "ACTIVE" } })).id;
  host = `rev-${tag}.plataforma.test`;
  const p = await prisma.product.create({ data: { storeId, slug: "p", name: "P", weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  productId = p.id;
  const v = await prisma.variant.create({ data: { storeId, productId, sku: `S-${tag}`, color: "Azul", size: "G", priceCents: 5000, stock: 5 } });
  const mk = (k: string) => prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
  buyer = (await mk("buyer")).id;
  stranger = (await mk("stranger")).id;
  const o = await prisma.order.create({ data: { storeId, customerId: buyer, status: "PAID", subtotalCents: 5000, shippingCents: 0, totalCents: 5000, shippingService: "PAC", addressSnapshot: {} } });
  await prisma.orderItem.create({ data: { storeId, orderId: o.id, variantId: v.id, productName: "P", sku: "S", color: "Azul", size: "G", unitPriceCents: 5000, quantity: 1 } });
});
afterAll(async () => {
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.plan.deleteMany({ where: { name: "Teste-RevApi" } });
  await prisma.$disconnect();
});
beforeEach(() => getSession.mockReset());

describe("POST /api/reviews", () => {
  it("sem login 401; origem cruzada 403; corpo invalido 400", async () => {
    getSession.mockResolvedValue(null);
    expect((await send({ productId, rating: 5 })).status).toBe(401);
    getSession.mockResolvedValue(customerSession(buyer));
    expect((await send({ productId, rating: 5 }, { origin: "http://evil.example" })).status).toBe(403);
    expect((await send({ productId, rating: 9 })).status).toBe(400);
  });
  it("cliente de outra loja ou conta da plataforma nao avalia", async () => {
    getSession.mockResolvedValue(customerSession(buyer, "outra-loja"));
    expect((await send({ productId, rating: 5 })).status).toBe(401);
    getSession.mockResolvedValue({ user: { id: "x", kind: "account" }, expires: "2099-01-01" });
    expect((await send({ productId, rating: 5 })).status).toBe(401);
  });
  it("quem nao comprou 403; comprador 201 uma vez e depois 409", async () => {
    getSession.mockResolvedValue(customerSession(stranger));
    const r = await send({ productId, rating: 5 });
    expect([r.status, (await r.json()).error]).toEqual([403, "NOT_PURCHASER"]);
    getSession.mockResolvedValue(customerSession(buyer));
    expect((await send({ productId, rating: 4, comment: "bom" })).status).toBe(201);
    const again = await send({ productId, rating: 4 });
    expect([again.status, (await again.json()).error]).toEqual([409, "ALREADY_REVIEWED"]);
  });
});
