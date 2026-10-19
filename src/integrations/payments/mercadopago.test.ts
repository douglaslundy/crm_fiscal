import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MercadoPagoGateway, verifyWebhookSignature } from "./mercadopago";
import { PaymentGatewayError } from "./types";

const API = "https://api.mercadopago.com";
const TOKEN = "APP_USR-segredo-da-loja-123";
const NOW = new Date("2026-10-18T12:00:00.000Z");
const payer = { email: "cli@t.local", cpf: "52998224725" };

function setup(response: { status?: number; body?: unknown; throws?: Error } = {}) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    if (response.throws) throw response.throws;
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
  });
  const gw = new MercadoPagoGateway({
    accessToken: TOKEN, notificationUrl: "https://loja.exemplo.com/api/webhooks/mercadopago/s1",
    fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW,
  });
  const sent = (i = 0) => {
    const [url, init] = fetch.mock.calls[i];
    return { url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined, signal: init?.signal };
  };
  return { gw, fetch, sent };
}

describe("MercadoPagoGateway", () => {
  it("payCard: POST /v1/payments com Bearer da loja, X-Idempotency-Key, valor em reais, token do Brick, parcelas e webhook da loja", async () => {
    const { gw, sent } = setup({ body: { id: 123, status: "approved", transaction_amount: 100.01 } });
    expect(await gw.payCard({ orderId: "o1", amountCents: 10001, token: "tok", installments: 3, paymentMethodId: "visa", payer }, "order:o1:card:abc"))
      .toEqual({ id: "123", status: "approved" });
    const r = sent();
    expect(r.url).toBe(`${API}/v1/payments`);
    expect(r.method).toBe("POST");
    expect(r.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "X-Idempotency-Key": "order:o1:card:abc" });
    expect(r.signal).toBeInstanceOf(AbortSignal);
    expect(r.body).toEqual({
      transaction_amount: 100.01, description: "Pedido o1", external_reference: "o1",
      notification_url: "https://loja.exemplo.com/api/webhooks/mercadopago/s1",
      payer: { email: "cli@t.local", identification: { type: "CPF", number: "52998224725" } },
      token: "tok", installments: 3, payment_method_id: "visa",
    });
  });

  it("payPix: payment_method_id pix, expira em 30 min, devolve QR, copia-e-cola e a expiracao do MP", async () => {
    const { gw, sent } = setup({ body: {
      id: 9, status: "pending", date_of_expiration: "2026-10-18T09:30:00.000-03:00",
      point_of_interaction: { transaction_data: { qr_code: "000201PIX", qr_code_base64: "iVBOR" } },
    } });
    const r = await gw.payPix({ orderId: "o1", amountCents: 9500, payer }, "order:o1:pix");
    expect(r).toEqual({ id: "9", status: "pending", qrCode: "000201PIX", qrCodeBase64: "iVBOR", expiresAt: new Date("2026-10-18T12:30:00.000Z") });
    const s = sent();
    expect(s.headers["X-Idempotency-Key"]).toBe("order:o1:pix");
    expect(s.body).toMatchObject({ transaction_amount: 95, payment_method_id: "pix", date_of_expiration: "2026-10-18T12:30:00.000Z", external_reference: "o1" });
    expect(s.body.token).toBeUndefined();
  });

  it("payBoleto: bolbradesco com nome e endereco do pagador, vence em 3 dias, devolve URL e linha digitavel", async () => {
    const boletoPayer = { ...payer, firstName: "Ana", lastName: "Souza", address: { zip: "01001000", street: "Praça da Sé", number: "100", district: "Sé", city: "São Paulo", state: "SP" } };
    const { gw, sent } = setup({ body: { id: 11, status: "pending", transaction_details: { external_resource_url: "https://www.mercadopago.com.br/payments/11/ticket" }, barcode: { content: "34191790010104351004791020150008" } } });
    const r = await gw.payBoleto({ orderId: "o1", amountCents: 10001, payer: boletoPayer }, "order:o1:boleto");
    expect(r).toEqual({ id: "11", status: "pending", url: "https://www.mercadopago.com.br/payments/11/ticket", barcode: "34191790010104351004791020150008", expiresAt: new Date("2026-10-21T12:00:00.000Z") });
    const s = sent();
    expect(s.headers["X-Idempotency-Key"]).toBe("order:o1:boleto");
    expect(s.body).toMatchObject({
      transaction_amount: 100.01, payment_method_id: "bolbradesco", external_reference: "o1", date_of_expiration: "2026-10-21T12:00:00.000Z",
      payer: { email: "cli@t.local", first_name: "Ana", last_name: "Souza", identification: { type: "CPF", number: "52998224725" },
        address: { zip_code: "01001000", street_name: "Praça da Sé", street_number: "100", neighborhood: "Sé", city: "São Paulo", federal_unit: "SP" } },
    });
    expect(s.body.token).toBeUndefined();
  });
  it("payBoleto: resposta sem URL https do boleto -> erro do gateway", async () => {
    const boletoPayer = { ...payer, firstName: "A", lastName: "B", address: { zip: "1", street: "r", number: "1", district: "d", city: "c", state: "SP" } };
    const { gw } = setup({ body: { id: 11, status: "pending", transaction_details: { external_resource_url: "http://inseguro" } } });
    await expect(gw.payBoleto({ orderId: "o1", amountCents: 1, payer: boletoPayer }, "k")).rejects.toBeInstanceOf(PaymentGatewayError);
  });

  it("getPayment: GET /v1/payments/{id}; mapeia status, valor em centavos, tipo e referencia", async () => {
    const { gw, sent } = setup({ body: { id: 7, status: "in_process", external_reference: "o1", transaction_amount: 19.9, payment_type_id: "bank_transfer" } });
    expect(await gw.getPayment("7")).toEqual({ id: "7", status: "pending", externalReference: "o1", amountCents: 1990, paymentTypeId: "bank_transfer" });
    expect(sent()).toMatchObject({ url: `${API}/v1/payments/7`, method: "GET" });
    expect(sent().headers.Authorization).toBe(`Bearer ${TOKEN}`);
    for (const [mp, ours] of [["charged_back", "refunded"], ["cancelled", "cancelled"], ["rejected", "rejected"], ["xyz", "pending"]]) {
      const { gw: g } = setup({ body: { id: 1, status: mp } });
      expect((await g.getPayment("1")).status).toBe(ours);
    }
  });

  it("erro HTTP, rede ou timeout -> PaymentGatewayError sem token nem detalhe", async () => {
    for (const r of [{ status: 500, body: { message: TOKEN } }, { throws: new Error(`falhou com ${TOKEN}`) }]) {
      const { gw } = setup(r);
      const e = await gw.payCard({ orderId: "o1", amountCents: 100, token: "t", installments: 1, paymentMethodId: "visa", payer }, "k").catch((x) => x);
      expect(e).toBeInstanceOf(PaymentGatewayError);
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toContain("tok");
    }
    const { gw } = setup({ body: { id: 1, status: "pending" } });
    await expect(gw.payPix({ orderId: "o1", amountCents: 1, payer }, "k")).rejects.toBeInstanceOf(PaymentGatewayError); // sem QR
  });
});

describe("verifyWebhookSignature", () => {
  const sign = (manifest: string, secret = "whsec") => createHmac("sha256", secret).update(manifest).digest("hex");
  const h = (sig: string, reqId?: string) => new Headers({ "x-signature": sig, ...(reqId ? { "x-request-id": reqId } : {}) });

  it("valida o manifesto id;request-id;ts com o segredo; data.id alfanumerico em minusculas", () => {
    expect(verifyWebhookSignature(h(`ts=1700,v1=${sign("id:123;request-id:r1;ts:1700;")}`, "r1"), "123", "whsec")).toBe(true);
    expect(verifyWebhookSignature(h(`ts=1700,v1=${sign("id:abc9;request-id:r1;ts:1700;")}`, "r1"), "ABC9", "whsec")).toBe(true);
    expect(verifyWebhookSignature(h(`ts=1700,v1=${sign("id:123;ts:1700;")}`), "123", "whsec")).toBe(true);
  });

  it("recusa: segredo errado/vazio, outro id, outro request-id, sem ts, sem cabecalho", () => {
    const good = `ts=1700,v1=${sign("id:123;request-id:r1;ts:1700;")}`;
    expect(verifyWebhookSignature(h(good, "r1"), "123", "outro")).toBe(false);
    expect(verifyWebhookSignature(h(good, "r1"), "123", "")).toBe(false);
    expect(verifyWebhookSignature(h(good, "r1"), "124", "whsec")).toBe(false);
    expect(verifyWebhookSignature(h(good, "r2"), "123", "whsec")).toBe(false);
    expect(verifyWebhookSignature(h(`v1=${sign("id:123;request-id:r1;ts:;")}`, "r1"), "123", "whsec")).toBe(false);
    expect(verifyWebhookSignature(new Headers(), "123", "whsec")).toBe(false);
    expect(verifyWebhookSignature(h(good, "r1"), "", "whsec")).toBe(false);
  });
});
