import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeShipping } from "./fakeShipping";
import { getShippingProvider } from "./index";
import { MelhorEnvioShipping, toCents } from "./melhorEnvio";
import { ShippingError } from "./types";

const TOKEN = "me-secret-token-123";
const pk = [{ weightGrams: 1500, heightCm: 5, widthCm: 20, lengthCm: 30, insuranceCents: 12345 }];
const input = { fromCep: "37175000", toCep: "01001000", packages: pk };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const initOf = (f: ReturnType<typeof vi.fn>) => (f.mock.calls[0] as unknown as [string, RequestInit]);

afterEach(() => vi.unstubAllEnvs());

describe("toCents", () => {
  it("converte sem erro de float", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("19")).toBe(1900);
    expect(toCents("1.005")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents(8.1)).toBe(810);
  });
});

describe("MelhorEnvioShipping", () => {
  it("envia o pedido no formato products e o token so no Authorization", async () => {
    const f = vi.fn(async () => json([]));
    await new MelhorEnvioShipping({ token: TOKEN, fetch: f, baseUrl: "https://sandbox.example" }).quote(input);
    const [url, init] = initOf(f);
    expect(url).toBe("https://sandbox.example/api/v2/me/shipment/calculate");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(Object.entries(h).filter(([k, v]) => k !== "Authorization" && v.includes(TOKEN))).toEqual([]);
    expect(String(init.body)).not.toContain(TOKEN);
    expect(h["User-Agent"]).toMatch(/Plataforma Lojas/);
    expect(JSON.parse(String(init.body))).toEqual({
      from: { postal_code: "37175000" }, to: { postal_code: "01001000" },
      products: [{ id: "1", width: 20, height: 5, length: 30, weight: 1.5, insurance_value: 123.45, quantity: 1 }],
    });
  });

  it("converte precos em centavos, descarta erro, ordena por preco", async () => {
    const f = vi.fn(async () => json([
      { name: "SEDEX", company: { name: "Correios" }, price: "30.10", delivery_time: 2 },
      { name: "PAC", company: { name: "Correios" }, price: "12.34", delivery_time: 6, custom_delivery_time: 7 },
      { name: "Jadlog", error: "Serviço indisponível" },
      { name: "Sem preco", delivery_time: 3 },
    ]));
    expect(await new MelhorEnvioShipping({ token: TOKEN, fetch: f }).quote(input)).toEqual([
      { service: "Correios PAC", priceCents: 1234, days: 7 },
      { service: "Correios SEDEX", priceCents: 3010, days: 2 },
    ]);
  });

  it.each([
    ["non-2xx", async () => json({ message: TOKEN }, 401)],
    ["malformado", async () => json({ not: "array" })],
    ["json invalido", async () => new Response("<html>", { status: 200 })],
    ["rede/timeout", async () => { throw Object.assign(new Error(`boom ${TOKEN}`), { name: "TimeoutError" }); }],
  ])("%s -> ShippingError sem vazar o token", async (_n, impl) => {
    const err = await new MelhorEnvioShipping({ token: TOKEN, fetch: vi.fn(impl) }).quote(input).catch((e) => e);
    expect(err).toBeInstanceOf(ShippingError);
    expect(err.message).not.toContain(TOKEN);
  });

  it("passa um AbortSignal (timeout)", async () => {
    const f = vi.fn(async () => json([]));
    await new MelhorEnvioShipping({ token: TOKEN, fetch: f }).quote(input);
    expect(initOf(f)[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("getShippingProvider", () => {
  it("token -> Melhor Envio", () => expect(getShippingProvider(TOKEN)).toBeInstanceOf(MelhorEnvioShipping));
  it("sem token: fake fora de producao, null em producao", () => {
    expect(getShippingProvider(undefined)).toBeInstanceOf(FakeShipping);
    vi.stubEnv("NODE_ENV", "production");
    expect(getShippingProvider(undefined)).toBeNull();
    expect(getShippingProvider(TOKEN)).toBeInstanceOf(MelhorEnvioShipping);
  });
});
