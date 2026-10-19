import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { FakeShipping } from "@/integrations/shipping/fakeShipping";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("@/auth", async (orig) => ({ ...(await orig<typeof import("@/auth")>()), getSession: vi.fn() }));
const getSession = vi.mocked((await import("@/auth")).getSession);
const order = await import("./order/route");
const address = await import("./address/route");

let tag: string;
let planId: string;
const stores: string[] = [];
let A: { id: string; slug: string };
let B: { id: string; slug: string };
let custA: { id: string; addressId: string };
let custB: { id: string; addressId: string };

async function mkCustomer(storeId: string, k: string) {
  const c = await prisma.customer.create({ data: { storeId, name: k, email: `${k}-${tag}@t.local`, cpf: "52998224725", phone: "11999999999", passwordHash: "x" } });
  const a = await prisma.address.create({ data: { storeId, customerId: c.id, cep: "01001000", street: "Rua", number: "1", district: "Centro", city: "SP", state: "SP" } });
  return { id: c.id, addressId: a.id };
}
async function mkVariant(storeId: string, k: string, stock = 5, price = 5000) {
  const p = await prisma.product.create({ data: { storeId, slug: `p-${k}-${tag}`, name: `Prod ${k}`, weightGrams: 400, heightCm: 5, widthCm: 20, lengthCm: 30 } });
  return (await prisma.variant.create({ data: { storeId, productId: p.id, sku: `sku-${k}-${tag}`, color: "Preto", size: "M", priceCents: price, stock } })).id;
}
const login = (c: { id: string } | null, storeId?: string, kind: "customer" | "account" = "customer") =>
  getSession.mockResolvedValue(c ? ({ user: { id: c.id, kind, storeId }, expires: "x" } as Session) : null);

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.upsert({
    where: { name: "Teste-Chk" }, update: {},
    create: { name: "Teste-Chk", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = await prisma.store.create({ data: { slug: `chk-a-${tag}`, name: "A", planId } });
  B = await prisma.store.create({ data: { slug: `chk-b-${tag}`, name: "B", planId } });
  stores.push(A.id, B.id);
  custA = await mkCustomer(A.id, "ca");
  custB = await mkCustomer(B.id, "cb");
  getSession.mockReset();
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Chk" } });
  await prisma.$disconnect();
});

const req = (s: { slug: string }, path: string, method: string, body?: unknown, extra: Record<string, string> = {}) => {
  const h = { "content-type": "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: `${s.slug}.localhost`, ...extra };
  return new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
};
const postOrder = (body: unknown, s = A, extra: Record<string, string> = {}) => order.POST(req(s, "/api/checkout/order", "POST", body, extra));

describe("POST /api/checkout/order", () => {
  it("201: total do servidor (preco do banco + FakeShipping); precos/frete/totais enviados pelo cliente ignorados", async () => {
    const v = await mkVariant(A.id, "v", 5, 4000);
    login(custA, A.id);
    const res = await postOrder({
      lines: [{ variantId: v, qty: 2, priceCents: 1, unitCents: 1 }], addressId: custA.addressId, shippingService: "PAC",
      shippingCents: 0, totalCents: 1, subtotalCents: 1,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const [pac] = await new FakeShipping().quote({ fromCep: "37175000", toCep: "01001000", packages: [{ weightGrams: 800, heightCm: 10, widthCm: 20, lengthCm: 30, insuranceCents: 8000 }] });
    expect(body.totalCents).toBe(8000 + pac.priceCents);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId } });
    expect(o).toMatchObject({ storeId: A.id, customerId: custA.id, subtotalCents: 8000, shippingCents: pac.priceCents, totalCents: 8000 + pac.priceCents, shippingService: "PAC" });
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: v } })).stock).toBe(3);
  });

  it("401 anonimo, conta da plataforma ou cliente de outra loja; 403 CSRF; 404 loja desconhecida", async () => {
    const v = await mkVariant(A.id, "v");
    const body = { lines: [{ variantId: v, qty: 1 }], addressId: custA.addressId, shippingService: "PAC" };
    login(null);
    expect((await postOrder(body)).status).toBe(401);
    login(custA, undefined, "account");
    expect((await postOrder(body)).status).toBe(401);
    login(custB, B.id);
    expect((await postOrder(body)).status).toBe(401);
    login(custB, A.id); // token forjado com storeId de A, mas o cliente nao existe em A
    expect((await postOrder(body)).status).toBe(401);
    login(custA, A.id);
    expect((await postOrder(body, A, { origin: "http://evil.example" })).status).toBe(403);
    expect((await postOrder(body, { id: "x", slug: `nao-existe-${tag}` })).status).toBe(404);
    expect(await prisma.order.count({ where: { storeId: A.id } })).toBe(0);
  });

  it("mapeia erros do frete: SEM_ESTOQUE (corrida), FRETE_INDISPONIVEL, ITEM_FORA_DOS_LIMITES", async () => {
    const v = await mkVariant(A.id, "v", 1);
    login(custA, A.id);
    const body = { lines: [{ variantId: v, qty: 1 }], addressId: custA.addressId, shippingService: "PAC" };
    const spy = vi.spyOn(FakeShipping.prototype, "quote");
    try {
      spy.mockImplementationOnce(async (input) => {
        await prisma.variant.update({ where: { id: v }, data: { stock: 0 } }); // outro pedido levou a ultima unidade
        return new FakeShipping().quote(input); // a chamada "once" ja foi consumida: esta vai ao original
      });
      const out = await postOrder(body);
      expect(out.status).toBe(409);
      expect(await out.json()).toEqual({ error: "SEM_ESTOQUE", variantId: v });
      await prisma.variant.update({ where: { id: v }, data: { stock: 1 } });
      spy.mockRejectedValueOnce(new Error("segredo-interno"));
      const down = await postOrder(body);
      expect(down.status).toBe(502);
      expect(await down.json()).toEqual({ error: "FRETE_INDISPONIVEL" });
    } finally {
      spy.mockRestore();
    }
    await prisma.product.updateMany({ where: { storeId: A.id }, data: { weightGrams: 31000 } });
    const big = await postOrder(body);
    expect(big.status).toBe(422);
    expect(await big.json()).toEqual({ error: "ITEM_FORA_DOS_LIMITES" });
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: v } })).stock).toBe(1);
  });

  it("mapeia erros: CARRINHO_ALTERADO, ENDERECO_INVALIDO, FRETE_INVALIDO, CARRINHO_VAZIO, 400 corpo", async () => {
    const v = await mkVariant(A.id, "v", 1);
    const foreign = await mkVariant(B.id, "f");
    login(custA, A.id);
    const changed = await postOrder({ lines: [{ variantId: v, qty: 1 }, { variantId: foreign, qty: 1 }], addressId: custA.addressId, shippingService: "PAC" });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "CARRINHO_ALTERADO", issues: [{ variantId: foreign, kind: "INACTIVE", available: 0 }] });
    const addr = await postOrder({ lines: [{ variantId: v, qty: 1 }], addressId: custB.addressId, shippingService: "PAC" });
    expect(addr.status).toBe(400);
    expect(await addr.json()).toEqual({ error: "ENDERECO_INVALIDO" });
    const ship = await postOrder({ lines: [{ variantId: v, qty: 1 }], addressId: custA.addressId, shippingService: "TELETRANSPORTE" });
    expect(ship.status).toBe(409);
    expect(await ship.json()).toEqual({ error: "FRETE_INVALIDO" });
    const empty = await postOrder({ lines: [], addressId: custA.addressId, shippingService: "PAC" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "CARRINHO_VAZIO" });
    expect((await postOrder({ lines: [{ variantId: v, qty: 0 }], addressId: custA.addressId, shippingService: "PAC" })).status).toBe(400);
    expect((await postOrder({ lines: [{ variantId: v, qty: 1 }, { variantId: v, qty: 1 }], addressId: custA.addressId, shippingService: "PAC" })).status).toBe(400);
    expect((await prisma.variant.findUniqueOrThrow({ where: { id: v } })).stock).toBe(1);
  });

  it("loja suspensa -> 403 STORE_UNAVAILABLE", async () => {
    const v = await mkVariant(A.id, "v");
    login(custA, A.id);
    await prisma.store.update({ where: { id: A.id }, data: { status: "SUSPENDED" } });
    const res = await postOrder({ lines: [{ variantId: v, qty: 1 }], addressId: custA.addressId, shippingService: "PAC" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "STORE_UNAVAILABLE" });
  });

  it("rate limit: 11a requisicao no minuto do mesmo cliente -> 429", async () => {
    login(custA, A.id);
    const body = { lines: [], addressId: custA.addressId, shippingService: "PAC" };
    for (let i = 0; i < 10; i++) expect((await postOrder(body)).status).toBe(400);
    const res = await postOrder(body);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("/api/checkout/address", () => {
  it("POST cria para o cliente da sessao (dono do corpo ignorado); GET lista so os dele", async () => {
    login(custA, A.id);
    const res = await address.POST(req(A, "/api/checkout/address", "POST", {
      cep: "37.175-000", street: " Rua Nova ", number: "10", district: "Centro", city: "Ilicínea", state: "mg", customerId: custB.id, storeId: B.id,
    }));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ cep: "37175000", street: "Rua Nova", state: "MG", complement: null });
    const row = await prisma.address.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ storeId: A.id, customerId: custA.id });
    const list = await (await address.GET(req(A, "/api/checkout/address", "GET"))).json();
    expect(list.addresses.map((a: { id: string }) => a.id).sort()).toEqual([custA.addressId, created.id].sort());
  });

  it("400 CEP/UF invalidos; 401 sem sessao; 403 CSRF", async () => {
    login(custA, A.id);
    const ok = { cep: "01001000", street: "R", number: "1", district: "D", city: "C", state: "SP" };
    expect((await address.POST(req(A, "/api/checkout/address", "POST", { ...ok, cep: "123" }))).status).toBe(400);
    expect((await address.POST(req(A, "/api/checkout/address", "POST", { ...ok, state: "São Paulo" }))).status).toBe(400);
    expect((await address.POST(req(A, "/api/checkout/address", "POST", ok, { origin: "http://evil.example" }))).status).toBe(403);
    login(null);
    expect((await address.POST(req(A, "/api/checkout/address", "POST", ok))).status).toBe(401);
    expect((await address.GET(req(A, "/api/checkout/address", "GET"))).status).toBe(401);
  });
});
