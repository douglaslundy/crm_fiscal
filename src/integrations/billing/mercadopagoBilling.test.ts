import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MercadoPagoBilling } from "./mercadopagoBilling";
import { BillingError } from "./types";

const API = "https://api.mercadopago.com";
function setup(response: { status?: number; body?: unknown } = {}) {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    new Response(JSON.stringify(response.body ?? {}), { status: response.status ?? 200 }));
  const gw = new MercadoPagoBilling({
    accessToken: "TOKEN-123",
    webhookSecret: "whsec",
    fetch: fetch as unknown as typeof globalThis.fetch,
    getPlan: async (id) => ({ id, name: "Pro", priceCents: 12900 }),
    backUrl: async (storeId) => `https://loja-${storeId}.exemplo.com/admin/assinatura`,
  });
  const sent = (i = 0) => {
    const [url, init] = fetch.mock.calls[i];
    return { url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
  };
  return { gw, fetch, sent };
}

describe("MercadoPagoBilling", () => {
  it("createSubscription: POST /preapproval com Bearer, valor em reais, email, external_reference e back_url", async () => {
    const { gw, sent } = setup({ body: { id: "2c93abc", init_point: "https://mp/checkout/2c93abc", status: "pending" } });
    expect(await gw.createSubscription({ storeId: "s1", planId: "p1", payerEmail: "dono@t.local" })).toEqual({
      checkoutUrl: "https://mp/checkout/2c93abc", externalId: "2c93abc",
    });
    const r = sent();
    expect(r.url).toBe(`${API}/preapproval`);
    expect(r.method).toBe("POST");
    expect(r.headers.Authorization).toBe("Bearer TOKEN-123");
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(r.body).toEqual({
      reason: "Assinatura Pro",
      external_reference: "s1",
      payer_email: "dono@t.local",
      back_url: "https://loja-s1.exemplo.com/admin/assinatura",
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 129, currency_id: "BRL" },
      status: "pending",
    });
  });

  it("changePlan: PUT /preapproval/{id} com o novo valor", async () => {
    const { gw, sent } = setup();
    await gw.changePlan("2c93/abc", "p2");
    const r = sent();
    expect(r.url).toBe(`${API}/preapproval/2c93%2Fabc`);
    expect(r.method).toBe("PUT");
    expect(r.headers.Authorization).toBe("Bearer TOKEN-123");
    expect(r.body).toEqual({ reason: "Assinatura Pro", auto_recurring: { transaction_amount: 129, currency_id: "BRL" } });
  });

  it("cancel: PUT status cancelled", async () => {
    const { gw, sent } = setup();
    await gw.cancel("abc");
    expect(sent()).toMatchObject({ url: `${API}/preapproval/abc`, method: "PUT", body: { status: "cancelled" } });
  });

  it("getSubscription: GET e mapeia status e proximo pagamento", async () => {
    const { gw, sent } = setup({ body: { id: "abc", status: "authorized", next_payment_date: "2027-04-10T12:00:00.000-04:00" } });
    expect(await gw.getSubscription("abc")).toEqual({ status: "authorized", nextPaymentAt: new Date("2027-04-10T16:00:00Z") });
    expect(sent()).toMatchObject({ url: `${API}/preapproval/abc`, method: "GET" });
    expect(sent().headers.Authorization).toBe("Bearer TOKEN-123");
  });

  it("getSubscription: status desconhecido vira pending (sem mudanca) e loga aviso sem segredo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const status of ["finished", undefined]) {
        const { gw } = setup({ body: { status } });
        expect(await gw.getSubscription("abc")).toEqual({ status: "pending", nextPaymentAt: null });
      }
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain("finished");
      expect(warn.mock.calls.flat().join(" ")).not.toContain("TOKEN-123");
    } finally {
      warn.mockRestore();
    }
  });

  it("resposta 2xx que nao e JSON vira BillingError (nao SyntaxError)", async () => {
    const fetch = vi.fn(async () => new Response("<html>oops</html>", { status: 200 }));
    const gw = new MercadoPagoBilling({ accessToken: "t", webhookSecret: "w", fetch: fetch as never });
    await expect(gw.getSubscription("abc")).rejects.toBeInstanceOf(BillingError);
  });

  it("resposta nao-2xx vira BillingError sem vazar o token", async () => {
    for (const status of [400, 401, 404, 500]) {
      const { gw } = setup({ status, body: { message: "erro" } });
      const e = await gw.cancel("abc").then(() => null, (x) => x);
      expect(e).toBeInstanceOf(BillingError);
      expect(String(e.message)).toContain(String(status));
      expect(String(e.message)).not.toContain("TOKEN-123");
    }
  });

  it("createSubscription sem id ou init_point na resposta e erro", async () => {
    const { gw } = setup({ body: { status: "pending" } });
    await expect(gw.createSubscription({ storeId: "s1", planId: "p1", payerEmail: "a@b.c" })).rejects.toBeInstanceOf(BillingError);
  });

  describe("verifyWebhook (x-signature)", () => {
    const sign = (manifest: string, secret = "whsec") => createHmac("sha256", secret).update(manifest).digest("hex");
    const headers = (sig: string, reqId = "req-1") => new Headers({ "x-signature": sig, "x-request-id": reqId });

    it("aceita HMAC-SHA256 hex de id:{dataId};request-id:{x-request-id};ts:{ts};", () => {
      const { gw } = setup();
      const v1 = sign("id:abc123;request-id:req-1;ts:1704908010;");
      expect(gw.verifyWebhook(headers(`ts=1704908010,v1=${v1}`), "abc123")).toBe(true);
    });

    it("recusa segredo errado, dataId trocado, cabecalho ausente ou malformado", () => {
      const { gw } = setup();
      const v1 = sign("id:abc123;request-id:req-1;ts:1704908010;");
      expect(gw.verifyWebhook(headers(`ts=1704908010,v1=${sign("id:abc123;request-id:req-1;ts:1704908010;", "outro")}`), "abc123")).toBe(false);
      expect(gw.verifyWebhook(headers(`ts=1704908010,v1=${v1}`), "abc124")).toBe(false);
      expect(gw.verifyWebhook(headers(`ts=1704908011,v1=${v1}`), "abc123")).toBe(false);
      expect(gw.verifyWebhook(new Headers(), "abc123")).toBe(false);
      expect(gw.verifyWebhook(headers("lixo"), "abc123")).toBe(false);
      expect(gw.verifyWebhook(headers(`ts=1704908010,v1=${v1.slice(2)}`), "abc123")).toBe(false);
    });

    it("sem segredo configurado recusa tudo", () => {
      const gw = new MercadoPagoBilling({ accessToken: "t", webhookSecret: "", fetch: vi.fn() as never });
      const v1 = createHmac("sha256", "").update("id:a;request-id:req-1;ts:1;").digest("hex");
      expect(gw.verifyWebhook(headers(`ts=1,v1=${v1}`), "a")).toBe(false);
    });
  });
});
