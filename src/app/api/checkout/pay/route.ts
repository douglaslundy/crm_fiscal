import { NextResponse } from "next/server";
import { z } from "zod";
import { PayError, payOrder, type PayErrorCode } from "@/domain/payments";
import { StoreSuspendedError } from "@/domain/subscription";
import { gatewayForStore } from "@/integrations/payments";
import { PaymentGatewayError, PaymentsNotConfiguredError } from "@/integrations/payments/types";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { err } from "@/lib/master-api";
import { createRateLimiter } from "@/lib/rate-limit";

const payLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// Zod remove chaves desconhecidas: valor/total enviados pelo navegador nunca chegam a payOrder. Cartao = so o token do Brick.
const Body = z.discriminatedUnion("method", [
  z.object({ orderId: z.string().min(1).max(64), method: z.literal("pix") }),
  z.object({
    orderId: z.string().min(1).max(64),
    method: z.literal("card"),
    card: z.object({ token: z.string().min(1).max(256), installments: z.number().int().min(1).max(3), paymentMethodId: z.string().min(1).max(40) }),
  }),
]);

const ERRORS: Record<PayErrorCode, [number, string]> = {
  NOT_FOUND: [404, "Não encontrado."],
  NOT_PENDING: [409, "PEDIDO_NAO_PENDENTE"],
  PIX_EXPIRED: [409, "PIX_EXPIRADO"],
  REJECTED: [402, "PAGAMENTO_RECUSADO"],
};

/** Paga (cartao ou Pix) um pedido do cliente logado nesta loja. Valor sempre do pedido no servidor. */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const { store, customerId } = ctx;
  const rl = payLimiter.check(`${store.id}|${customerId}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  try {
    const gw = await gatewayForStore(store.id);
    const r = await payOrder({ storeId: store.id, customerId, ...parsed.data }, gw);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof PayError) return err(...ERRORS[e.code]);
    if (e instanceof PaymentsNotConfiguredError) return err(422, "PAGAMENTO_NAO_CONFIGURADO");
    if (e instanceof StoreSuspendedError) return err(403, "STORE_UNAVAILABLE");
    if (e instanceof PaymentGatewayError) {
      console.error(`[pay] loja ${store.id}: ${e.message}`);
      return err(502, "PAGAMENTO_INDISPONIVEL");
    }
    throw e;
  }
}
