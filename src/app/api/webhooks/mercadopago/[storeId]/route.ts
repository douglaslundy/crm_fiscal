import { NextResponse } from "next/server";
import { syncPayment } from "@/domain/payments";
import { getStoreCredentials } from "@/domain/storeSettings";
import { gatewayForStore } from "@/integrations/payments";
import { verifyWebhookSignature } from "@/integrations/payments/mercadopago";
import { PaymentGatewayError, PaymentsNotConfiguredError } from "@/integrations/payments/types";
import { prisma } from "@/lib/db";
import { err } from "@/lib/master-api";

const ok = () => NextResponse.json({ ok: true });

/**
 * Webhook de pagamento DE UMA loja (publico: a autenticacao e a assinatura com o segredo DESSA loja; sem sessao/CSRF).
 * Loja desconhecida 404; loja sem segredo 401 (nunca segredo padrao); assinatura invalida 401 antes de ler pedidos.
 * O corpo so diz QUAL pagamento mudou: estado e valor sao relidos no gateway da loja. 200 = tratado ou no-op (o MP para de
 * reenviar); 5xx so em falha transitoria (gateway fora do ar / loja sem access token), para o MP tentar de novo.
 */
export async function POST(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) return err(404, "Não encontrado.");
  const { mpWebhookSecret } = await getStoreCredentials(store.id);
  if (!mpWebhookSecret) {
    console.error(`[webhook-mp] loja ${store.id} sem segredo de webhook configurado`);
    return err(401, "Assinatura inválida.");
  }
  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { type?: unknown; topic?: unknown; data?: { id?: unknown } } | null;
  const dataId = url.searchParams.get("data.id") ?? (body?.data?.id == null ? "" : String(body.data.id));
  if (!verifyWebhookSignature(req.headers, dataId, mpWebhookSecret)) return err(401, "Assinatura inválida.");
  const type = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? body?.type ?? body?.topic;
  if (type !== "payment") return ok();

  try {
    const r = await syncPayment(store.id, dataId, await gatewayForStore(store.id));
    return r === "not_found" ? err(404, "Não encontrado.") : ok();
  } catch (e) {
    if (e instanceof PaymentGatewayError && e.status === 404) return ok(); // pagamento inexistente nesta conta: nada a fazer
    if (e instanceof PaymentGatewayError || e instanceof PaymentsNotConfiguredError) {
      console.error(`[webhook-mp] loja ${store.id}: ${e.message}`);
      return err(503, "Indisponível.");
    }
    throw e;
  }
}
