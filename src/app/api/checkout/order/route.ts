import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_QTY } from "@/domain/cart";
import {
  AddressInvalidError, CartChangedError, createOrder, EmptyCartError, OutOfStockError, OversizeItemError, ShippingOptionInvalidError,
  TotalChangedError, TotalTooLargeError,
} from "@/domain/orders";
import { getStoreCredentials } from "@/domain/storeSettings";
import { StoreSuspendedError } from "@/domain/subscription";
import { getShippingProvider } from "@/integrations/shipping";
import { ShippingError } from "@/integrations/shipping/types";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { err } from "@/lib/master-api";
import { createRateLimiter } from "@/lib/rate-limit";

const orderLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// Zod remove chaves desconhecidas: preco, frete e totais enviados pelo navegador nunca chegam a createOrder.
const Body = z.object({
  lines: z.array(z.object({ variantId: z.string().max(64), qty: z.number().int().min(1).max(MAX_QTY) })).max(50)
    .refine((ls) => new Set(ls.map((l) => l.variantId)).size === ls.length, "Variação repetida"),
  addressId: z.string().min(1).max(64),
  shippingService: z.string().min(1).max(64),
  expectedTotalCents: z.number().int().min(0).optional(), // so comparado com o total do servidor
});

/** Cria o pedido do cliente logado na loja do host. Valores sempre do banco e da cotacao refeita no servidor. */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const { store, customerId } = ctx;
  const rl = orderLimiter.check(`${store.id}|${customerId}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");

  const provider = getShippingProvider((await getStoreCredentials(store.id)).melhorEnvioToken);
  if (!provider) return err(422, "FRETE_NAO_CONFIGURADO");
  try {
    const order = await createOrder({ storeId: store.id, customerId, ...parsed.data }, { provider });
    return NextResponse.json({ orderId: order.id, totalCents: order.totalCents }, { status: 201 });
  } catch (e) {
    if (e instanceof StoreSuspendedError) return err(403, "STORE_UNAVAILABLE");
    if (e instanceof CartChangedError) return err(409, "CARRINHO_ALTERADO", { issues: e.issues });
    if (e instanceof OutOfStockError) return err(409, "SEM_ESTOQUE", { variantId: e.variantId });
    if (e instanceof AddressInvalidError) return err(400, "ENDERECO_INVALIDO");
    if (e instanceof ShippingOptionInvalidError) return err(409, "FRETE_INVALIDO");
    if (e instanceof EmptyCartError) return err(400, "CARRINHO_VAZIO");
    if (e instanceof TotalChangedError) return err(409, "TOTAL_ALTERADO", { totalCents: e.totalCents });
    if (e instanceof TotalTooLargeError) return err(422, "TOTAL_MUITO_ALTO");
    if (e instanceof OversizeItemError) return err(422, "ITEM_FORA_DOS_LIMITES");
    if (e instanceof ShippingError) return err(502, "FRETE_INDISPONIVEL");
    throw e;
  }
}
