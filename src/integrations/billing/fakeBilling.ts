import { BillingError, type AuthorizedPayment, type BillingGateway, type BillingStatus } from "./types";

type FakeSub = { storeId: string; planId: string; payerEmail: string; status: BillingStatus; nextPaymentAt: Date | null };

/** Gateway em memoria para desenvolvimento e testes (sem credenciais do Mercado Pago). */
export class FakeBilling implements BillingGateway {
  readonly subs = new Map<string, FakeSub>();
  readonly payments = new Map<string, AuthorizedPayment>();
  private n = 0;

  /** Assinatura aceita por verifyWebhook: so serve para testes/dev, nunca em producao (ver getBilling). */
  static sign(dataId: string) {
    return `fake:${dataId}`;
  }

  async createSubscription(input: { storeId: string; planId: string; payerEmail: string }) {
    const externalId = `fake-${input.storeId}-${++this.n}`;
    this.subs.set(externalId, { ...input, status: "pending", nextPaymentAt: null });
    return { checkoutUrl: `/admin/assinatura?checkout=${externalId}`, externalId };
  }

  async changePlan(externalId: string, planId: string) {
    this.get(externalId).planId = planId;
  }

  async cancel(externalId: string) {
    this.get(externalId).status = "cancelled";
  }

  async getSubscription(externalId: string) {
    const { status, nextPaymentAt } = this.get(externalId);
    return { status, nextPaymentAt };
  }

  async getAuthorizedPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new BillingError(`Cobranca ${id} inexistente`);
    return p;
  }

  verifyWebhook(headers: Headers, dataId: string) {
    return headers.get("x-signature") === FakeBilling.sign(dataId);
  }

  /** Teste: simula mudanca de estado no gateway. */
  set(externalId: string, status: BillingStatus, nextPaymentAt: Date | null = null) {
    Object.assign(this.get(externalId), { status, nextPaymentAt });
  }

  private get(externalId: string) {
    const s = this.subs.get(externalId);
    if (!s) throw new BillingError(`Assinatura ${externalId} inexistente`);
    return s;
  }
}
