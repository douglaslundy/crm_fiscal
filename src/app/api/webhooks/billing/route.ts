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
  // shortcut: so subscription_preapproval; subscription_authorized_payment exigiria GET /authorized_payments/{id}.
  if (type !== "subscription_preapproval") return ok();

  const sub = await prisma.subscription.findUnique({ where: { mpPreapprovalId: dataId }, select: { storeId: true } });
  if (!sub) return ok();
  const remote = await gw.getSubscription(dataId);
  await applyBillingEvent(sub.storeId, remote.status, new Date(), { periodEnd: remote.nextPaymentAt });
  return ok();
}
