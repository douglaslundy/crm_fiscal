import { NextResponse } from "next/server";
import { ResetBody, ResetTokenError, resetPassword } from "@/domain/passwordReset";
import { assertSameOriginJson } from "@/lib/csrf";
import { err } from "@/lib/master-api";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });

/** Publico: troca a senha com o token recebido por e-mail (uso unico, 1h). */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = ResetBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  try {
    await resetPassword(parsed.data.token, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ResetTokenError) return err(400, "TOKEN_INVALIDO");
    throw e;
  }
}
