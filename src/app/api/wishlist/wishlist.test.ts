import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ getSession }));

import { afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "./route";

let planId: string;
let storeId: string;
let host: string;
let productId: string;
let customerId: string;

const session = (id = customerId, sid = storeId) => ({ user: { id, kind: "customer", storeId: sid }, expires: "2099-01-01" });
const send = (body: unknown, origin = "http://localhost") =>
  POST(new Request("http://localhost/api/wishlist", {
    method: "POST", headers: { "content-type": "application/json", origin, "x-store-host": host }, body: JSON.stringify(body),
  }));

beforeAll(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  process.env.PLATFORM_DOMAIN = "plataforma.test";
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-WlApi" }, update: {},
    create: { name: "Teste-WlApi", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  storeId = (await prisma.store.create({ data: { slug: `wl-${tag}`, name: "L", planId, status: "ACTIVE" } })).id;
  host = `wl-${tag}.plataforma.test`;
  productId = (await prisma.product.create({ data: { storeId, slug: "p", name: "P", weightGrams: 300, heightCm: 5, widthCm: 20, lengthCm: 30 } })).id;
  customerId = (await prisma.customer.create({ data: { storeId, name: "c", email: `c-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
});
afterAll(async () => {
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.plan.deleteMany({ where: { name: "Teste-WlApi" } });
  await prisma.$disconnect();
});
beforeEach(() => getSession.mockReset());

describe("POST /api/wishlist", () => {
  it("sem login 401; origem cruzada 403; corpo invalido 400; cliente de outra loja 401", async () => {
    getSession.mockResolvedValue(null);
    expect((await send({ productId, on: true })).status).toBe(401);
    getSession.mockResolvedValue(session());
    expect((await send({ productId, on: true }, "http://evil.example")).status).toBe(403);
    expect((await send({ productId })).status).toBe(400);
    getSession.mockResolvedValue(session(customerId, "outra"));
    expect((await send({ productId, on: true })).status).toBe(401);
  });
  it("favorita e desfavorita (idempotente); produto desconhecido 404", async () => {
    getSession.mockResolvedValue(session());
    expect((await send({ productId, on: true })).status).toBe(200);
    expect((await send({ productId, on: true })).status).toBe(200);
    expect(await prisma.wishlistItem.count({ where: { customerId } })).toBe(1);
    expect((await send({ productId, on: false })).status).toBe(200);
    expect(await prisma.wishlistItem.count({ where: { customerId } })).toBe(0);
    const r = await send({ productId: "nao-existe", on: true });
    expect([r.status, (await r.json()).error]).toEqual([404, "PRODUCT_NOT_FOUND"]);
  });
});
