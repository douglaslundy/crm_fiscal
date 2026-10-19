import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER, platformDomain } from "@/lib/host";
import { assertSameOriginJson } from "@/lib/csrf";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { EmailExistsError, PlanNotFoundError, SlugInvalidError, SlugTakenError, createStore } from "@/domain/stores";

const Body = z.object({
  ownerName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(72), // bcrypt ignora alem de 72 bytes
  storeName: z.string().trim().min(2).max(60),
  slug: z.string().trim().optional().transform((s) => s || undefined),
  planId: z.string().min(1),
});

const signupLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 });

const err = (status: number, error: string, extra?: object) => NextResponse.json({ error, ...extra }, { status });

/** Cadastro de lojista; so no host da plataforma. */
export async function POST(req: Request) {
  const csrf = assertSameOriginJson(req);
  if (csrf) return csrf;
  if (req.headers.get(STORE_HOST_HEADER)) return err(404, "Não encontrado.");
  const rl = signupLimiter.check(clientIp(req.headers));
  if (!rl.ok) return NextResponse.json({ error: "MUITAS_REQUISICOES" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.", { fields: z.flattenError(parsed.error).fieldErrors });

  try {
    const { store } = await createStore(parsed.data, { db: prisma });
    const domain = platformDomain();
    const proto = domain === "localhost" ? "http" : "https";
    return NextResponse.json({ storeUrl: `${proto}://${store.slug}.${domain}`, slug: store.slug }, { status: 201 });
  } catch (e) {
    if (e instanceof EmailExistsError) return err(409, "EMAIL_EXISTS");
    if (e instanceof SlugTakenError) return err(409, "SLUG_TAKEN");
    if (e instanceof SlugInvalidError) return err(400, "SLUG_INVALID");
    if (e instanceof PlanNotFoundError) return err(400, "PLAN_NOT_FOUND");
    throw e;
  }
}
