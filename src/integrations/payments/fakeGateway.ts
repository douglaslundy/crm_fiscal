import { randomUUID } from "node:crypto";
import { PaymentGatewayError, PIX_TTL_MS, type GatewayResult, type PaymentGateway, type PaymentStatus, type PixResult, type RemotePayment } from "./types";

const CARD_TOKENS: readonly string[] = ["approved", "rejected", "pending"] satisfies PaymentStatus[];

/**
 * Gateway em memoria (desenvolvimento sem credenciais e testes). Deterministico: o token do cartao decide o status
 * ("approved" | "rejected" | "pending"; outro token = rejected). Mesma chave de idempotencia = mesmo pagamento (como o MP).
 */
export class FakeGateway implements PaymentGateway {
  readonly payments = new Map<string, RemotePayment & { qrCode?: string; expiresAt?: Date }>();
  private readonly byKey = new Map<string, string>();

  private create(key: string, p: Omit<RemotePayment, "id">, extra: { qrCode?: string; expiresAt?: Date } = {}) {
    const known = this.byKey.get(key);
    if (known) return this.payments.get(known)!;
    const id = `fake-${randomUUID()}`;
    const payment = { id, ...p, ...extra };
    this.payments.set(id, payment);
    this.byKey.set(key, id);
    return payment;
  }

  async payCard(input: Parameters<PaymentGateway["payCard"]>[0], key: string): Promise<GatewayResult> {
    const status = (CARD_TOKENS.includes(input.token) ? input.token : "rejected") as PaymentStatus;
    const p = this.create(key, { status, externalReference: input.orderId, amountCents: input.amountCents, paymentTypeId: "credit_card" });
    return { id: p.id, status: p.status };
  }

  async payPix(input: Parameters<PaymentGateway["payPix"]>[0], key: string): Promise<PixResult> {
    const p = this.create(
      key,
      { status: "pending", externalReference: input.orderId, amountCents: input.amountCents, paymentTypeId: "bank_transfer" },
      { qrCode: `00020126FAKEPIX${input.orderId}`, expiresAt: new Date(Date.now() + PIX_TTL_MS) },
    );
    return { id: p.id, status: p.status, qrCode: p.qrCode!, qrCodeBase64: "", expiresAt: p.expiresAt! };
  }

  async getPayment(id: string): Promise<RemotePayment> {
    const p = this.payments.get(id);
    if (!p) throw new PaymentGatewayError(`Pagamento ${id} inexistente`, 404);
    return { id: p.id, status: p.status, externalReference: p.externalReference, amountCents: p.amountCents, paymentTypeId: p.paymentTypeId };
  }

  /** Teste/dev: simula mudanca no gateway (ou cria um pagamento qualquer). */
  put(p: RemotePayment) {
    this.payments.set(p.id, { ...this.payments.get(p.id), ...p });
  }
}
