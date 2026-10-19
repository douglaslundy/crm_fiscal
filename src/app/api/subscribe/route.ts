import { NextResponse } from "next/server";
import { SubscribeBody, subscribe } from "@/domain/subscribers";
import { isStoreBlocked } from "@/domain/subscription";
import { assertSameOriginJson } from "@/lib/csrf";
import { STORE_HOST_HEADER, platformDomain } from "@/lib/host";
import { err } from "@/lib/master-api";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { resolveStoreByHost } from "@/lib/tenant";

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });

/** Publico: inscreve um e-mail na lista da loja do host (header do middleware, nunca do corpo). Sempre 201 para e-mail valido, repetido ou novo. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const host = req.headers.get(STORE_HOST_HEADER);
  const store = host ? await resolveStoreByHost(host, platformDomain()) : null;
  if (!store) return err(404, "Loja não encontrada.");
  if (isStoreBlocked(store)) return err(403, "STORE_UNAVAILABLE");
  const rl = limiter.check(`${store.id}|${clientIp(req.headers)}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = SubscribeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  await subscribe(store.id, parsed.data.email);
  return NextResponse.json({ ok: true }, { status: 201 });
}
