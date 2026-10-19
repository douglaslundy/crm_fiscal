import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { quoteCache } from "@/domain/shipping";
import { setCredentials } from "@/domain/storeSettings";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
const quote = vi.fn();
const getProvider = vi.fn((token: string | undefined) => (token === "NONE" ? null : { quote }));
vi.mock("@/integrations/shipping", () => ({ getShippingProvider: (t: string | undefined) => getProvider(t) }));
const nextHeaders = await import("next/headers");
const { POST } = await import("./route");

let tag: string;
let A: { id: string; slug: string };
let B: { id: string; slug: string };
const stores: string[] = [];

async function seed(storeId: string, k: string, o: { weight?: number; height?: number; price?: number; active?: boolean } = {}) {
  const p = await prisma.product.create({
    data: { storeId, slug: `p-${k}-${tag}`, name: `Prod ${k}`, weightGrams: o.weight ?? 400, heightCm: o.height ?? 5, widthCm: 20, lengthCm: 30, active: o.active ?? true },
  });
  return (await prisma.variant.create({
    data: { storeId, productId: p.id, sku: `sku-${k}-${tag}`, color: "Preto", size: "M", priceCents: o.price ?? 5000, stock: 10 },
  })).id;
}

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  quoteCache.clear();
  quote.mockReset().mockResolvedValue([{ service: "PAC", priceCents: 2000, days: 5 }]);
  const planId = (await prisma.plan.upsert({
    where: { name: "Teste-Ship" }, update: {},
    create: { name: "Teste-Ship", priceCents: 0, productLimit: 100, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false },
  })).id;
  A = await prisma.store.create({ data: { slug: `ship-a-${tag}`, name: "A", planId } });
  B = await prisma.store.create({ data: { slug: `ship-b-${tag}`, name: "B", planId } });
  stores.push(A.id, B.id);
});
afterEach(async () => {
  vi.mocked(nextHeaders.headers).mockReset();
  getProvider.mockClear();
  await prisma.store.deleteMany({ where: { id: { in: stores.splice(0) } } });
});
afterAll(async () => {
  await prisma.plan.deleteMany({ where: { name: "Teste-Ship" } });
  await prisma.$disconnect();
});

const call = (s: { slug: string }, body: unknown, extra: Record<string, string> = {}) => {
  const h = { "content-type": "application/json", origin: "http://localhost", [STORE_HOST_HEADER]: `${s.slug}.localhost`, ...extra };
  vi.mocked(nextHeaders.headers).mockResolvedValue(new Headers(h) as never);
  return POST(new Request("http://localhost/api/shipping/quote", { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) }));
};

describe("POST /api/shipping/quote", () => {
  it("200: opcoes + issues; peso/preco vem do banco (corpo ignorado); usa CEP de origem e token da loja", async () => {
    const a = await seed(A.id, "a", { weight: 700, price: 9000 });
    await setCredentials(A.id, { melhorEnvioToken: "tok-da-loja-a-12345" });
    const res = await call(A, { cep: "01001-000", lines: [{ variantId: a, qty: 2, weightGrams: 1, priceCents: 1 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ options: [{ service: "PAC", priceCents: 2000, days: 5 }], issues: [] });
    expect(getProvider).toHaveBeenCalledWith("tok-da-loja-a-12345");
    expect(quote).toHaveBeenCalledWith({
      fromCep: "37175000", toCep: "01001000",
      packages: [{ weightGrams: 1400, heightCm: 10, widthCm: 20, lengthCm: 30, insuranceCents: 18000 }],
    });
  });

  it("CEP invalido -> 400 CEP_INVALIDO; corpo invalido -> 400; sem same-origin -> bloqueado", async () => {
    const a = await seed(A.id, "a");
    const bad = await call(A, { cep: "123", lines: [{ variantId: a, qty: 1 }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "CEP_INVALIDO" });
    expect((await call(A, "nao-json")).status).toBe(400);
    expect((await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] }, { origin: "http://evil.example" })).status).toBe(403);
    expect(quote).not.toHaveBeenCalled();
  });

  it("carrinho vazio / so variacao de outra loja ou inativa -> 400 CARRINHO_VAZIO", async () => {
    const b = await seed(B.id, "b");
    const off = await seed(A.id, "off", { active: false });
    expect(await (await call(A, { cep: "01001000", lines: [] })).json()).toMatchObject({ error: "CARRINHO_VAZIO" });
    const res = await call(A, { cep: "01001000", lines: [{ variantId: b, qty: 1 }, { variantId: off, qty: 1 }] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "CARRINHO_VAZIO" });
    expect(quote).not.toHaveBeenCalled();
  });

  it("variacao de outra loja e ignorada, a valida e cotada", async () => {
    const a = await seed(A.id, "a");
    const b = await seed(B.id, "b");
    const res = await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }, { variantId: b, qty: 1 }] });
    expect(res.status).toBe(200);
    expect((await res.json()).issues).toEqual([{ variantId: b, kind: "INACTIVE", available: 0 }]);
    expect(quote.mock.calls[0][0].packages).toHaveLength(1);
    expect(quote.mock.calls[0][0].packages[0].weightGrams).toBe(400);
  });

  it("loja suspensa -> 403 STORE_UNAVAILABLE", async () => {
    const a = await seed(A.id, "a");
    await prisma.store.update({ where: { id: A.id }, data: { status: "SUSPENDED" } });
    const res = await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "STORE_UNAVAILABLE" });
  });

  it("provedor lanca -> 502 FRETE_INDISPONIVEL sem detalhe, e nao cacheia a falha", async () => {
    const a = await seed(A.id, "a");
    quote.mockRejectedValueOnce(new Error("segredo-interno"));
    const res = await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "FRETE_INDISPONIVEL" });
    expect((await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] })).status).toBe(200);
  });

  it("sem provedor (producao sem token) -> 422 FRETE_NAO_CONFIGURADO", async () => {
    const a = await seed(A.id, "a");
    getProvider.mockReturnValueOnce(null);
    const res = await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "FRETE_NAO_CONFIGURADO" });
  });

  it("cache: 2a chamada igual nao chama o provedor; outra loja nunca compartilha", async () => {
    const a = await seed(A.id, "a");
    const b = await seed(B.id, "b");
    const body = (v: string) => ({ cep: "01001000", lines: [{ variantId: v, qty: 1 }] });
    await call(A, body(a));
    await call(A, body(a));
    expect(quote).toHaveBeenCalledTimes(1);
    await call(B, body(b)); // mesmo CEP e mesmos pacotes, outra loja
    expect(quote).toHaveBeenCalledTimes(2);
    await call(A, { cep: "01002000", lines: [{ variantId: a, qty: 1 }] });
    expect(quote).toHaveBeenCalledTimes(3);
  });

  it("unidade acima dos limites -> 422 ITEM_FORA_DOS_LIMITES", async () => {
    const big = await seed(A.id, "big", { weight: 31000 });
    const res = await call(A, { cep: "01001000", lines: [{ variantId: big, qty: 1 }] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "ITEM_FORA_DOS_LIMITES" });
    expect(quote).not.toHaveBeenCalled();
  });

  it("resultado vazio nao e cacheado", async () => {
    const a = await seed(A.id, "a");
    quote.mockResolvedValue([]);
    await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] });
    await call(A, { cep: "01001000", lines: [{ variantId: a, qty: 1 }] });
    expect(quote).toHaveBeenCalledTimes(2);
  });

  it("requisicoes simultaneas identicas dividem 1 chamada ao provedor", async () => {
    const a = await seed(A.id, "a");
    let release!: () => void;
    quote.mockReturnValue(new Promise((r) => { release = () => r([{ service: "PAC", priceCents: 1, days: 1 }]); }));
    const body = { cep: "01001000", lines: [{ variantId: a, qty: 1 }] };
    const all = Promise.all([call(A, body), call(A, body), call(A, body)]);
    await vi.waitFor(() => expect(quote).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 200));
    release();
    const res = await all;
    expect(res.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it("21a requisicao no minuto -> 429 MUITAS_REQUISICOES com Retry-After; outro IP e outra loja nao sao afetados", async () => {
    const a = await seed(A.id, "a");
    const b = await seed(B.id, "b");
    const body = { cep: "01001000", lines: [{ variantId: a, qty: 1 }] };
    const ip = { "x-forwarded-for": "9.9.9.9, 10.0.0.1" };
    for (let i = 0; i < 20; i++) expect((await call(A, body, ip)).status).toBe(200);
    const res = await call(A, body, ip);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "MUITAS_REQUISICOES" });
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await call(A, body, { "x-forwarded-for": "8.8.8.8" })).status).toBe(200);
    expect((await call(B, { cep: "01001000", lines: [{ variantId: b, qty: 1 }] }, ip)).status).toBe(200);
  });
});
