import { NextResponse } from "next/server";
import { z } from "zod";
import { priceStoreCart } from "@/domain/cartServer";
import { isStoreBlocked } from "@/domain/subscription";
import { assertSameOriginJson } from "@/lib/csrf";
import { getCurrentStore } from "@/lib/tenant";

// Zod remove chaves desconhecidas: preco enviado pelo navegador nunca chega a priceCart.
const Body = z.object({ lines: z.array(z.object({ variantId: z.string().max(64), qty: z.number().finite() })).max(50) });

/** Publico (sem login): revalida o carrinho do navegador com preco/estoque do banco, so da loja do host. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const store = await getCurrentStore();
  if (isStoreBlocked(store)) return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  return NextResponse.json(await priceStoreCart(store.id, parsed.data.lines));
}
