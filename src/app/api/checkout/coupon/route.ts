import { NextResponse } from "next/server";
import { z } from "zod";
import { priceStoreCart } from "@/domain/cartServer";
import { CouponError, validateCoupon } from "@/domain/coupons";
import { dbForStore } from "@/lib/db-store";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { err } from "@/lib/master-api";
import { createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 }); // freia adivinhacao de codigos

const Body = z.object({
  code: z.string().max(40),
  lines: z.array(z.object({ variantId: z.string().max(64), qty: z.number().finite() })).max(50),
});

/** Simula o desconto do cupom sobre o carrinho (so informativo: createOrder revalida e consome). */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const rl = limiter.check(`${ctx.store.id}|${ctx.customerId}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  const { subtotalCents } = await priceStoreCart(ctx.store.id, parsed.data.lines);
  try {
    const { coupon, discountCents } = await validateCoupon(dbForStore(ctx.store.id), parsed.data.code, ctx.customerId, subtotalCents);
    return NextResponse.json({ code: coupon.code, discountCents });
  } catch (e) {
    if (e instanceof CouponError) return err(e.status, e.code, e.extra);
    throw e;
  }
}
