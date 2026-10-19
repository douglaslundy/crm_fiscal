import { NextResponse } from "next/server";
import { z } from "zod";
import { priceStoreCart } from "@/domain/cartServer";
import { isStoreBlocked } from "@/domain/subscription";
import { assertSameOriginJson } from "@/lib/csrf";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { getCurrentStore } from "@/lib/tenant";

const priceLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const MAX_BODY = 16_384; // 50 linhas cabem com folga

// Zod remove chaves desconhecidas: preco enviado pelo navegador nunca chega a priceCart.
const Body = z.object({ lines: z.array(z.object({ variantId: z.string().max(64), qty: z.number().finite() })).max(50) });

/** Publico (sem login): revalida o carrinho do navegador com preco/estoque do banco, so da loja do host. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const store = await getCurrentStore();
  if (isStoreBlocked(store)) return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 403 });
  const rl = priceLimiter.check(`${store.id}|${clientIp(req.headers)}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const tooBig = () => NextResponse.json({ error: "CORPO_GRANDE_DEMAIS" }, { status: 413 });
  if (Number(req.headers.get("content-length")) > MAX_BODY) return tooBig(); // recusa antes de ler o corpo
  const raw = await req.text().catch(() => "");
  if (Buffer.byteLength(raw) > MAX_BODY) return tooBig(); // sem content-length (chunked) ou mentindo
  let json: unknown = null;
  try { json = JSON.parse(raw); } catch {}
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  return NextResponse.json(await priceStoreCart(store.id, parsed.data.lines));
}
