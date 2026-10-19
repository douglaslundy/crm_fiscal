import { NextResponse } from "next/server";
import { z } from "zod";
import { WishlistError, addToWishlist, removeFromWishlist } from "@/domain/wishlist";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { err } from "@/lib/master-api";
import { createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const Body = z.object({ productId: z.string().min(1).max(64), on: z.boolean() });

/** Favorita (on: true) ou desfavorita (on: false) um produto para o cliente logado. Idempotente. */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const rl = limiter.check(`${ctx.store.id}|${ctx.customerId}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  const { productId, on } = parsed.data;
  try {
    if (on) await addToWishlist(ctx.store.id, ctx.customerId, productId);
    else await removeFromWishlist(ctx.store.id, ctx.customerId, productId);
    return NextResponse.json({ on });
  } catch (e) {
    if (e instanceof WishlistError) return err(e.status, e.code);
    throw e;
  }
}
