import { NextResponse } from "next/server";
import { ReviewBody, ReviewError, createReview } from "@/domain/reviews";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { err } from "@/lib/master-api";
import { createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });

/** Cliente logado avalia um produto que comprou (pedido pago). Uma avaliacao por produto. */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const rl = limiter.check(`${ctx.store.id}|${ctx.customerId}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = ReviewBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  try {
    return NextResponse.json(await createReview(ctx.store.id, ctx.customerId, parsed.data), { status: 201 });
  } catch (e) {
    if (e instanceof ReviewError) return err(e.status, e.code);
    throw e;
  }
}
