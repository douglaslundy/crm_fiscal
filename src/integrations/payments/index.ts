import { prisma } from "@/lib/db";
import { platformDomain } from "@/lib/host";
import { getStoreCredentials } from "@/domain/storeSettings";
import { FakeGateway } from "./fakeGateway";
import { MercadoPagoGateway } from "./mercadopago";
import { PaymentsNotConfiguredError, type PaymentGateway } from "./types";

let fake: FakeGateway | undefined;
/** Instancia unica do FakeGateway (pagamento criado numa requisicao e lido no webhook/cron de outra). */
export const fakeGateway = () => (fake ??= new FakeGateway());

/**
 * Webhook da loja. Decisao: sempre `https://<slug>.<PLATFORM_DOMAIN>` (endereco primario que toda loja tem, mesmo
 * criterio do back_url da assinatura); dominio proprio pode mudar/nao estar verificado. A loja vem do caminho, nao do host.
 */
export const notificationUrl = (slug: string, storeId: string) =>
  `https://${slug}.${platformDomain()}/api/webhooks/mercadopago/${encodeURIComponent(storeId)}`;

/** Access token da loja -> Mercado Pago; sem ele, FakeGateway fora de producao, PaymentsNotConfiguredError em producao. */
export async function gatewayForStore(storeId: string, deps: { fetch?: typeof fetch } = {}): Promise<PaymentGateway> {
  const { mpAccessToken } = await getStoreCredentials(storeId);
  if (!mpAccessToken) {
    if (process.env.NODE_ENV === "production") throw new PaymentsNotConfiguredError("Loja sem credenciais do Mercado Pago");
    return fakeGateway();
  }
  const { slug } = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true } });
  return new MercadoPagoGateway({ accessToken: mpAccessToken, notificationUrl: notificationUrl(slug, storeId), fetch: deps.fetch });
}
