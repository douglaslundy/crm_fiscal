// Gateway de pagamento das vendas da loja (Mercado Pago da propria loja; FakeGateway sem credenciais fora de producao).
export type PaymentStatus = "approved" | "pending" | "rejected" | "cancelled" | "refunded";
export type Payer = { email: string; cpf: string };
export type GatewayResult = { id: string; status: PaymentStatus };
export type PixResult = GatewayResult & { qrCode: string; qrCodeBase64: string; expiresAt: Date };
export type RemotePayment = {
  id: string;
  status: PaymentStatus;
  externalReference: string;
  amountCents: number;
  /** "credit_card", "debit_card", "bank_transfer" (Pix)... */
  paymentTypeId: string;
};

export interface PaymentGateway {
  payCard(
    input: { orderId: string; amountCents: number; token: string; installments: number; paymentMethodId: string; payer: Payer },
    idempotencyKey: string,
  ): Promise<GatewayResult>;
  payPix(input: { orderId: string; amountCents: number; payer: Payer }, idempotencyKey: string): Promise<PixResult>;
  getPayment(id: string): Promise<RemotePayment>;
}

/** Falha de rede/HTTP do gateway. A mensagem nunca leva token nem corpo da resposta. */
export class PaymentGatewayError extends Error {
  name = "PaymentGatewayError";
  /** Status HTTP do gateway quando houve resposta (404 = pagamento inexistente); sem status = rede/timeout. */
  constructor(message: string, readonly status?: number, opts?: ErrorOptions) { super(message, opts); }
}

/** Loja sem access token do Mercado Pago em producao (em desenvolvimento cai no FakeGateway). */
export class PaymentsNotConfiguredError extends Error {
  name = "PaymentsNotConfiguredError";
}

export const PIX_TTL_MS = 30 * 60_000;
/** Tipo do Mercado Pago para Pix. */
export const isPixType = (paymentTypeId: string) => paymentTypeId === "bank_transfer";
