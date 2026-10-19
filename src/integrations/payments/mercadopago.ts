import { createHmac, timingSafeEqual } from "node:crypto";
import { BOLETO_TTL_MS, PaymentGatewayError, type BoletoResult, type GatewayResult, type PaymentGateway, type PaymentStatus, type PixResult, type RemotePayment } from "./types";

const API = "https://api.mercadopago.com";
const TIMEOUT_MS = 10_000;

// Status do MP -> nosso. Em analise/autorizado = pending; estorno/chargeback = refunded (so alerta).
const STATUS: Record<string, PaymentStatus> = {
  approved: "approved", pending: "pending", in_process: "pending", authorized: "pending", in_mediation: "pending",
  rejected: "rejected", cancelled: "cancelled", refunded: "refunded", charged_back: "refunded",
};

export type MercadoPagoGatewayDeps = {
  accessToken: string;
  /** URL publica do webhook DESTA loja (/api/webhooks/mercadopago/<storeId>). */
  notificationUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

/**
 * Checkout transparente (POST/GET /v1/payments) com o access token da loja; formato conferido na API publica de
 * pagamentos do MP. O cartao nunca passa pelo servidor: so o token do Card Payment Brick. Exercitado com fetch injetado.
 */
export class MercadoPagoGateway implements PaymentGateway {
  constructor(private readonly deps: MercadoPagoGatewayDeps) {}

  private async call(method: string, path: string, body?: object, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.deps.accessToken}`, "Content-Type": "application/json" };
    if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
    let res: Response;
    try {
      res = await (this.deps.fetch ?? fetch)(`${API}${path}`, {
        method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // sem detalhe da excecao na mensagem: nada de token/URL interna em log de erro
      throw new PaymentGatewayError(`Mercado Pago indisponível em ${method} ${path.split("/").slice(0, 3).join("/")}`, undefined, { cause: e });
    }
    if (!res.ok) throw new PaymentGatewayError(`Mercado Pago respondeu ${res.status} em ${method} ${path.split("/").slice(0, 3).join("/")}`, res.status);
    try {
      return JSON.parse(await res.text());
    } catch {
      throw new PaymentGatewayError(`Mercado Pago respondeu ${res.status} sem JSON em ${method}`);
    }
  }

  private base(input: { orderId: string; amountCents: number; payer: { email: string; cpf: string } }) {
    return {
      transaction_amount: input.amountCents / 100,
      description: `Pedido ${input.orderId}`,
      external_reference: input.orderId,
      notification_url: this.deps.notificationUrl,
      payer: { email: input.payer.email, identification: { type: "CPF", number: input.payer.cpf } },
    };
  }

  private parse(r: Record<string, unknown>): RemotePayment {
    if (r.id == null || typeof r.status !== "string") throw new PaymentGatewayError("Resposta do Mercado Pago sem id/status");
    let status = STATUS[r.status];
    if (!status) {
      // status novo/desconhecido: pending (nada muda) em vez de erro e retentativa infinita
      console.warn(`[payments] status desconhecido do Mercado Pago: ${String(r.status).slice(0, 40)}`);
      status = "pending";
    }
    return {
      id: String(r.id),
      status,
      externalReference: typeof r.external_reference === "string" ? r.external_reference : "",
      amountCents: typeof r.transaction_amount === "number" ? Math.round(r.transaction_amount * 100) : -1,
      paymentTypeId: typeof r.payment_type_id === "string" ? r.payment_type_id : "",
    };
  }

  async payCard(input: Parameters<PaymentGateway["payCard"]>[0], idempotencyKey: string): Promise<GatewayResult> {
    const r = await this.call("POST", "/v1/payments", {
      ...this.base(input), token: input.token, installments: input.installments, payment_method_id: input.paymentMethodId,
    }, idempotencyKey);
    const { id, status } = this.parse(r);
    return { id, status };
  }

  async payPix(input: Parameters<PaymentGateway["payPix"]>[0], idempotencyKey: string): Promise<PixResult> {
    const expiresAt = new Date((this.deps.now?.() ?? new Date()).getTime() + 30 * 60_000);
    const r = await this.call("POST", "/v1/payments", {
      ...this.base(input), payment_method_id: "pix", date_of_expiration: expiresAt.toISOString(),
    }, idempotencyKey);
    const { id, status } = this.parse(r);
    const data = (r.point_of_interaction as { transaction_data?: { qr_code?: unknown; qr_code_base64?: unknown } } | undefined)?.transaction_data;
    if (typeof data?.qr_code !== "string") throw new PaymentGatewayError("Resposta do Mercado Pago sem QR do Pix");
    // repeticao com a mesma chave devolve o pagamento original: vale a expiracao dele
    const remoteExp = typeof r.date_of_expiration === "string" ? new Date(r.date_of_expiration) : null;
    return {
      id, status, qrCode: data.qr_code, qrCodeBase64: typeof data.qr_code_base64 === "string" ? data.qr_code_base64 : "",
      expiresAt: remoteExp && !isNaN(remoteExp.getTime()) ? remoteExp : expiresAt,
    };
  }

  /**
   * Boleto (bolbradesco): o MP exige nome e endereco completo do pagador. URL do boleto em transaction_details.external_resource_url,
   * linha digitavel em barcode.content. shortcut: formato nao exercitado contra a API real (so com fetch injetado).
   */
  async payBoleto(input: Parameters<PaymentGateway["payBoleto"]>[0], idempotencyKey: string): Promise<BoletoResult> {
    const expiresAt = new Date((this.deps.now?.() ?? new Date()).getTime() + BOLETO_TTL_MS);
    const { payer } = input;
    const r = await this.call("POST", "/v1/payments", {
      ...this.base(input),
      payment_method_id: "bolbradesco",
      date_of_expiration: expiresAt.toISOString(),
      payer: {
        email: payer.email, first_name: payer.firstName, last_name: payer.lastName, identification: { type: "CPF", number: payer.cpf },
        address: { zip_code: payer.address.zip, street_name: payer.address.street, street_number: payer.address.number, neighborhood: payer.address.district, city: payer.address.city, federal_unit: payer.address.state },
      },
    }, idempotencyKey);
    const { id, status } = this.parse(r);
    const url = (r.transaction_details as { external_resource_url?: unknown } | undefined)?.external_resource_url;
    const barcode = (r.barcode as { content?: unknown } | undefined)?.content;
    if (typeof url !== "string" || !url.startsWith("https://")) throw new PaymentGatewayError("Resposta do Mercado Pago sem URL do boleto");
    const remoteExp = typeof r.date_of_expiration === "string" ? new Date(r.date_of_expiration) : null;
    return { id, status, url, barcode: typeof barcode === "string" ? barcode : "", expiresAt: remoteExp && !isNaN(remoteExp.getTime()) ? remoteExp : expiresAt };
  }

  async getPayment(id: string): Promise<RemotePayment> {
    return this.parse(await this.call("GET", `/v1/payments/${encodeURIComponent(id)}`));
  }
}

/**
 * x-signature "ts=..,v1=.." = HMAC-SHA256 hex de `id:{dataId};request-id:{x-request-id};ts:{ts};` (doc do MP; data.id
 * alfanumerico vai em minusculas no manifesto). Comparacao em tempo constante. Segredo vazio = sempre falso.
 * Sem janela de ts (igual ao webhook da assinatura, Task 7): repetir uma notificacao valida so faz reler o pagamento no
 * gateway, e as transicoes sao idempotentes; uma janela com relogio torto perderia notificacao legitima.
 */
export function verifyWebhookSignature(headers: Headers, dataId: string, secret: string): boolean {
  const sig = headers.get("x-signature");
  if (!secret || !sig || !dataId) return false;
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=").map((s) => s.trim())));
  const { ts, v1 } = parts as Record<string, string | undefined>;
  if (!ts || !/^\d+$/.test(ts) || !v1) return false;
  const reqId = headers.get("x-request-id");
  const manifest = `id:${dataId.toLowerCase()};${reqId ? `request-id:${reqId};` : ""}ts:${ts};`;
  const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const got = Buffer.from(v1);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
