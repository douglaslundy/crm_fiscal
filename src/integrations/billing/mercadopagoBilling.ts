import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingError, type BillingGateway, type BillingStatus } from "./types";

const API = "https://api.mercadopago.com";
const STATUSES: readonly string[] = ["authorized", "pending", "paused", "cancelled"] satisfies BillingStatus[];

type Plan = { id: string; name: string; priceCents: number };
export type MercadoPagoDeps = {
  accessToken: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  getPlan?: (planId: string) => Promise<Plan>;
  backUrl?: (storeId: string) => Promise<string>;
};

/**
 * Assinaturas do Mercado Pago sem plano associado (POST/PUT/GET /preapproval), formato conferido no SDK oficial
 * (sdk-nodejs, src/clients/preApproval). Sem credenciais ainda: exercitado so com fetch injetado nos testes.
 */
export class MercadoPagoBilling implements BillingGateway {
  constructor(private readonly deps: MercadoPagoDeps) {}

  private async plan(planId: string) {
    if (!this.deps.getPlan) throw new BillingError("getPlan nao configurado");
    return this.deps.getPlan(planId);
  }

  private async call(method: string, path: string, body?: object): Promise<Record<string, unknown>> {
    const res = await (this.deps.fetch ?? fetch)(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.deps.accessToken}`, "Content-Type": "application/json" },
      body: body && JSON.stringify(body),
    });
    if (!res.ok) throw new BillingError(`Mercado Pago respondeu ${res.status} em ${method} ${path}`);
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new BillingError(`Mercado Pago respondeu ${res.status} sem JSON em ${method} ${path}`);
    }
  }

  async createSubscription({ storeId, planId, payerEmail }: { storeId: string; planId: string; payerEmail: string }) {
    const plan = await this.plan(planId);
    if (!this.deps.backUrl) throw new BillingError("backUrl nao configurado");
    const r = await this.call("POST", "/preapproval", {
      reason: `Assinatura ${plan.name}`,
      external_reference: storeId,
      payer_email: payerEmail,
      back_url: await this.deps.backUrl(storeId),
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: plan.priceCents / 100, currency_id: "BRL" },
      status: "pending", // sem card_token_id: o pagador conclui no init_point
    });
    if (typeof r.id !== "string" || typeof r.init_point !== "string") throw new BillingError("Resposta do Mercado Pago sem id/init_point");
    return { checkoutUrl: r.init_point, externalId: r.id };
  }

  async changePlan(externalId: string, planId: string) {
    const plan = await this.plan(planId);
    await this.call("PUT", `/preapproval/${encodeURIComponent(externalId)}`, {
      reason: `Assinatura ${plan.name}`,
      auto_recurring: { transaction_amount: plan.priceCents / 100, currency_id: "BRL" },
    });
  }

  async cancel(externalId: string) {
    await this.call("PUT", `/preapproval/${encodeURIComponent(externalId)}`, { status: "cancelled" });
  }

  async getSubscription(externalId: string) {
    const r = await this.call("GET", `/preapproval/${encodeURIComponent(externalId)}`);
    let status = r.status as BillingStatus;
    if (typeof r.status !== "string" || !STATUSES.includes(r.status)) {
      // status novo/desconhecido: tratado como pending (nao muda nada) em vez de 500 e retentativa infinita
      console.warn(`[billing] status desconhecido do Mercado Pago para ${externalId}: ${String(r.status).slice(0, 40)}`);
      status = "pending";
    }
    const next = typeof r.next_payment_date === "string" ? new Date(r.next_payment_date) : null;
    return { status, nextPaymentAt: next && !isNaN(next.getTime()) ? next : null };
  }

  /** x-signature "ts=..,v1=.." = HMAC-SHA256 hex de `id:{dataId};request-id:{x-request-id};ts:{ts};` (igual ao SDK oficial). */
  verifyWebhook(headers: Headers, dataId: string) {
    const secret = this.deps.webhookSecret;
    const sig = headers.get("x-signature");
    if (!secret || !sig) return false;
    const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=").map((s) => s.trim())));
    const { ts, v1 } = parts as Record<string, string | undefined>;
    if (!ts || !/^\d+$/.test(ts) || !v1) return false;
    const reqId = headers.get("x-request-id");
    const manifest = `${dataId ? `id:${dataId};` : ""}${reqId ? `request-id:${reqId};` : ""}ts:${ts};`;
    const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
    const got = Buffer.from(v1);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
}
