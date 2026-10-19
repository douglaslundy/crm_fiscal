import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvite } from "@/domain/team";
import { SettingsError } from "@/domain/storeSettings";
import { PlanLimitError } from "@/domain/entitlements";
import { assertSameOriginJson } from "@/lib/csrf";
import { STORE_HOST_HEADER } from "@/lib/host";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

const Body = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(72), // bcrypt ignora alem de 72 bytes
});

const limiter = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
const err = (status: number, error: string, extra?: object) => NextResponse.json({ error, ...extra }, { status });

/** Aceite de convite de equipe; so no host da plataforma. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  if (req.headers.get(STORE_HOST_HEADER)) return err(404, "Não encontrado.");
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.");
  try {
    const { token, ...input } = parsed.data;
    return NextResponse.json(await acceptInvite(token, input), { status: 201 });
  } catch (e) {
    if (e instanceof SettingsError) return err(e.status, e.code);
    if (e instanceof PlanLimitError) return err(403, "STAFF_LIMIT");
    throw e;
  }
}
