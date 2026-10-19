// Gateway de cobranca da assinatura da plataforma (Mercado Pago preapproval; FakeBilling sem credenciais).
export type BillingStatus = "authorized" | "pending" | "paused" | "cancelled";
/** Cobranca mensal de uma assinatura (topico subscription_authorized_payment). */
export type AuthorizedPayment = { preapprovalId: string; status: "approved" | "rejected" | "other" };

export interface BillingGateway {
  createSubscription(input: { storeId: string; planId: string; payerEmail: string }): Promise<{ checkoutUrl: string; externalId: string }>;
  changePlan(externalId: string, planId: string): Promise<void>;
  cancel(externalId: string): Promise<void>;
  getSubscription(externalId: string): Promise<{ status: BillingStatus; nextPaymentAt: Date | null }>;
  getAuthorizedPayment(id: string): Promise<AuthorizedPayment>;
  verifyWebhook(headers: Headers, dataId: string): boolean;
}

export class BillingError extends Error {
  name = "BillingError";
}
