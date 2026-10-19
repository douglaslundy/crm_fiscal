import { prisma } from "@/lib/db";
import { platformDomain } from "@/lib/host";
import { FakeBilling } from "./fakeBilling";
import { MercadoPagoBilling } from "./mercadopagoBilling";
import type { BillingGateway } from "./types";

let fake: FakeBilling | undefined;

/** Mercado Pago com BILLING_MP_ACCESS_TOKEN; sem ele, FakeBilling (so fora de producao: la falha fechado). */
export function getBilling(): BillingGateway {
  const accessToken = process.env.BILLING_MP_ACCESS_TOKEN;
  if (!accessToken) {
    if (process.env.NODE_ENV === "production") throw new Error("BILLING_MP_ACCESS_TOKEN não configurado");
    return (fake ??= new FakeBilling());
  }
  const webhookSecret = process.env.BILLING_WEBHOOK_SECRET;
  // sem segredo todo webhook daria 401 em silencio: falha alto na configuracao
  if (!webhookSecret) throw new Error("BILLING_WEBHOOK_SECRET não configurado (obrigatório com BILLING_MP_ACCESS_TOKEN)");
  return new MercadoPagoBilling({
    accessToken,
    webhookSecret,
    getPlan: (id) => prisma.plan.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, priceCents: true } }),
    backUrl: async (storeId) => {
      const { slug } = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { slug: true } });
      return `https://${slug}.${platformDomain()}/admin/assinatura`;
    },
  });
}
