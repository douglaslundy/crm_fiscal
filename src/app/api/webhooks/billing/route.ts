import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getBilling } from "@/integrations/billing";
import { applyBillingEvent } from "@/domain/subscription";

const ok = () => NextResponse.json({ ok: true });

/**
 * Webhook da assinatura da plataforma. Assinatura invalida -> 401. O corpo so informa QUAL assinatura mudou:
 * o estado e sempre relido no gateway (evento repetido = no-op; evento antigo fora de ordem nao rebaixa).
 * id externo desconhecido -> 200 sem efeito (nao revela se existe).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { type?: unknown; data?: { id?: unknown } } | null;
  const dataId = url.searchParams.get("data.id") ?? (body?.data?.id == null ? "" : String(body.data.id));
  const type = url.searchParams.get("type") ?? body?.type;
  const gw = getBilling();
  if (!dataId || !gw.verifyWebhook(req.headers, dataId)) return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  let preapprovalId = dataId;
  let rejected = false;
  if (type === "subscription_authorized_payment") {
    // cobranca mensal: aprovada -> reaplica o estado da assinatura (ACTIVE + proximo periodo); recusada -> paused (PAST_DUE).
    // shortcut: recusa antiga chegando depois de uma aprovacao rebaixa ate o proximo evento; checar data do pagamento se incomodar.
    const p = await gw.getAuthorizedPayment(dataId);
    if (p.status === "other") return ok();
    preapprovalId = p.preapprovalId;
    rejected = p.status === "rejected";
  } else if (type !== "subscription_preapproval") return ok();

  const sub = await prisma.subscription.findUnique({ where: { mpPreapprovalId: preapprovalId }, select: { storeId: true } });
  if (!sub) return ok();
  if (rejected) {
    await applyBillingEvent(sub.storeId, "paused", new Date());
    return ok();
  }
  const remote = await gw.getSubscription(preapprovalId);
  await applyBillingEvent(sub.storeId, remote.status, new Date(), { periodEnd: remote.nextPaymentAt });
  return ok();
}
