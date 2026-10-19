import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { getSession } from "@/auth";
import {
  CategoryInUseError, CategoryNotFoundError, CategoryValidationError, MaxDepthError, ParentCycleError, ParentNotFoundError,
} from "@/domain/categories";
import { PlanLimitError, StoreNotFoundError, planLimitToHttp } from "@/domain/entitlements";
import { CollectionError } from "@/domain/collections";
import { CouponError } from "@/domain/coupons";
import { AdminOrderError } from "@/domain/adminOrders";
import { OrderNotFoundError } from "@/domain/orders";
import { ProductError } from "@/domain/products";
import { SettingsError } from "@/domain/storeSettings";
import { StoreSuspendedError } from "@/domain/subscription";
import { PlanInUseError, PlanNameTakenError, PlanValidationError } from "@/domain/masterPlans";
import { EmailExistsError, PasswordRequiredError, PlanNotFoundError, SlugInvalidError, SlugTakenError } from "@/domain/stores";
import { STORE_HOST_HEADER } from "./host";
import { requireMaster } from "./guards";
import { assertSameOriginJson } from "./csrf";

export const err = (status: number, error: string, extra?: object) => NextResponse.json({ error, ...extra }, { status });

/** Pagina /master: so no host da plataforma (404 em host de loja) e so master (requireMaster redireciona para /entrar). */
export async function masterPage() {
  if ((await headers()).get(STORE_HOST_HEADER)) notFound();
  return requireMaster();
}

/**
 * Route handler /api/master/**: devolve a resposta de recusa ou null. Host de loja 404; sem sessao 401; sessao que
 * nao e de conta master (cliente, lojista) 403; depois, CSRF (assertSameOriginJson) 403. A decisao final e sempre de requireMaster() (relido do banco).
 */
export async function denyUnlessMaster(req: Request): Promise<NextResponse | null> {
  if (req.headers.get(STORE_HOST_HEADER)) return err(404, "Não encontrado.");
  if (!(await getSession())) return err(401, "Não autenticado.");
  try {
    await requireMaster();
  } catch (e) {
    if (isRedirectError(e)) return err(403, "Acesso negado.");
    throw e;
  }
  // CSRF depois da autenticacao: quem nao e master recebe 401/403 sem aprender nada sobre a defesa.
  return assertSameOriginJson(req) as NextResponse | null;
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<{ data: z.infer<S> } | { res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  return parsed.success ? { data: parsed.data } : { res: err(400, "Dados inválidos.", { fields: z.flattenError(parsed.error).fieldErrors }) };
}

/** Erros de dominio conhecidos viram resposta; o resto sobe (500). */
export function domainError(e: unknown): NextResponse {
  if (e instanceof ProductError) return err(e.status, e.code);
  if (e instanceof SettingsError) return err(e.status, e.code, e.message === e.code ? undefined : { message: e.message });
  if (e instanceof z.ZodError) return err(400, "Dados inválidos.", { fields: z.flattenError(e).fieldErrors });
  if (e instanceof PlanLimitError) {
    const { status, body } = planLimitToHttp(e);
    return NextResponse.json(body, { status });
  }
  if (e instanceof StoreNotFoundError) return err(404, "STORE_NOT_FOUND");
  if (e instanceof PlanNotFoundError) return err(404, "PLAN_NOT_FOUND");
  if (e instanceof EmailExistsError) return err(409, "EMAIL_EXISTS");
  if (e instanceof SlugTakenError) return err(409, "SLUG_TAKEN");
  if (e instanceof PlanNameTakenError) return err(409, "PLAN_NAME_TAKEN");
  if (e instanceof PlanInUseError) return err(409, "PLAN_IN_USE");
  if (e instanceof SlugInvalidError) return err(400, "SLUG_INVALID");
  if (e instanceof PasswordRequiredError) return err(400, "PASSWORD_REQUIRED");
  if (e instanceof PlanValidationError) return err(400, "PLAN_INVALID");
  if (e instanceof StoreSuspendedError) return err(403, "STORE_SUSPENDED");
  if (e instanceof CategoryNotFoundError) return err(404, "CATEGORY_NOT_FOUND");
  if (e instanceof CategoryInUseError) return err(409, "CATEGORY_IN_USE");
  if (e instanceof ParentNotFoundError) return err(400, "PARENT_NOT_FOUND");
  if (e instanceof ParentCycleError) return err(400, "PARENT_CYCLE");
  if (e instanceof MaxDepthError) return err(400, "MAX_DEPTH");
  if (e instanceof CategoryValidationError) return err(400, "CATEGORY_INVALID");
  if (e instanceof AdminOrderError) return err(e.status, e.code, { message: e.message });
  if (e instanceof CollectionError) return err(e.status, e.code);
  if (e instanceof CouponError) return err(e.status, e.code, e.extra);
  if (e instanceof OrderNotFoundError) return err(404, "ORDER_NOT_FOUND");
  throw e;
}
