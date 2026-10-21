import { NextResponse } from "next/server";
import { sendPasswordResetEmail } from "@/domain/notifications";
import { ForgotBody, requestReset } from "@/domain/passwordReset";
import { assertSameOriginJson } from "@/lib/csrf";
import { STORE_HOST_HEADER, platformDomain } from "@/lib/host";
import { err } from "@/lib/master-api";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { resolveStoreByHost } from "@/lib/tenant";
import { platformOrigin, storeOrigin } from "@/lib/urls";

const limiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 });

/** Publico. Host de loja -> cliente da loja; host da plataforma -> conta (dono/equipe/master). Resposta sempre igual: nao revela quais e-mails existem. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const parsed = ForgotBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  const rl = limiter.check(`${clientIp(req.headers)}|${parsed.data.email}`);
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const host = req.headers.get(STORE_HOST_HEADER);
  if (host) {
    const store = await resolveStoreByHost(host, platformDomain());
    if (!store) return err(404, "Loja não encontrada.");
    const r = await requestReset("CUSTOMER", parsed.data.email, store.id);
    if (r) void sendPasswordResetEmail(r.email, r.name, `${storeOrigin(store.slug)}/redefinir-senha/${r.token}`);
  } else {
    const r = await requestReset("ACCOUNT", parsed.data.email, null);
    if (r) void sendPasswordResetEmail(r.email, r.name, `${platformOrigin()}/redefinir-senha/${r.token}`);
  }
  return NextResponse.json({ ok: true });
}
