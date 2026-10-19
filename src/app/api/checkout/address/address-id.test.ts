import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
const getSession = vi.mocked((await import("@/auth")).getSession);
const route = await import("./[id]/route");

let tag: string;
const stores: string[] = [];
let A: { id: string; slug: string };
let B: { id: string; slug: string };
let c1: string; // A
let c2: string; // A
let c3: string; // B
let addr: string; // de c1

const mk = async (storeId: string, k: string) =>
  (await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } })).id;
const login = (id: string | null, storeId?: string, kind: "customer" | "account" = "customer") =>
  getSession.mockResolvedValue(id ? ({ user: { id, kind, storeId }, expires: "x" } as Session) : null);
const body = { cep: "02002-000", street: "Nova", number: "9", district: "Bairro", city: "RJ", state: "rj" };
const call = (method: "PATCH" | "DELETE", s = A, id = addr, b: unknown = method === "PATCH" ? body : undefined, extra: Record<string, string> = {}) =>
  route[method](
    new Request(`http://localhost/api/checkout/address/${id}`, {
      method, headers: { "content-type": "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: `${s.slug}.localhost`, ...extra },
      body: b === undefined ? undefined : JSON.stringify(b),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  const planId = (await prisma.plan.upsert({
    where: { name: "Teste-AddrId" }, update: {},
    create: { name: "Teste-AddrId", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = await prisma.store.create({ data: { slug: `ai-a-${tag}`, name: "A", planId } });
  B = await prisma.store.create({ data: { slug: `ai-b-${tag}`, name: "B", planId } });
  stores.push(A.id, B.id);
  [c1, c2, c3] = [await mk(A.id, "c1"), await mk(A.id, "c2"), await mk(B.id, "c3")];
  addr = (await prisma.address.create({ data: { storeId: A.id, customerId: c1, cep: "01001000", street: "Rua", number: "1", district: "Centro", city: "SP", state: "SP" } })).id;
  getSession.mockReset();
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-AddrId" } });
  await prisma.$disconnect();
});

describe("PATCH/DELETE /api/checkout/address/[id]", () => {
  it("dono edita (CEP normalizado, UF maiuscula) e apaga", async () => {
    login(c1, A.id);
    const res = await call("PATCH");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: addr, cep: "02002000", state: "RJ", complement: null });
    expect((await call("DELETE")).status).toBe(204);
    expect(await prisma.address.count({ where: { id: addr } })).toBe(0);
  });
  it("400 dados invalidos", async () => {
    login(c1, A.id);
    expect((await call("PATCH", A, addr, { ...body, cep: "123" })).status).toBe(400);
  });
  it("endereco de outro cliente da loja = 404 e intacto", async () => {
    login(c2, A.id);
    expect((await call("PATCH")).status).toBe(404);
    expect((await call("DELETE")).status).toBe(404);
    expect(await prisma.address.findUniqueOrThrow({ where: { id: addr } })).toMatchObject({ street: "Rua" });
  });
  it("cliente de outra loja: 401 na loja A, 404 na loja B (host decide a loja)", async () => {
    login(c3, B.id);
    expect((await call("PATCH", A)).status).toBe(401);
    expect((await call("PATCH", B)).status).toBe(404);
    expect((await call("DELETE", B)).status).toBe(404);
    expect(await prisma.address.count({ where: { id: addr } })).toBe(1);
  });
  it("401 anonimo/conta da plataforma; 403 CSRF", async () => {
    login(null);
    expect((await call("DELETE")).status).toBe(401);
    login(c1, undefined, "account");
    expect((await call("DELETE")).status).toBe(401);
    login(c1, A.id);
    expect((await call("DELETE", A, addr, undefined, { origin: "http://evil.example" })).status).toBe(403);
    expect((await call("PATCH", A, addr, body, { origin: "http://evil.example" })).status).toBe(403);
    expect(await prisma.address.count({ where: { id: addr } })).toBe(1);
  });
});
