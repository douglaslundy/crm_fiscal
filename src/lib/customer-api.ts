import { NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { Store } from "@prisma/client";
import { isStoreBlocked } from "@/domain/subscription";
import { assertSameOriginJson } from "./csrf";
import { requireCustomer } from "./guards";
import { STORE_HOST_HEADER, platformDomain } from "./host";
import { err } from "./master-api";
import { resolveStoreByHost } from "./tenant";

export type CustomerCtx = { store: Store; customerId: string };

/**
 * Route handler de cliente da loja do host: loja desconhecida 404; loja suspensa/cancelada 403 STORE_UNAVAILABLE;
 * sem sessao de cliente DESTA loja (anonimo, conta da plataforma, cliente de outra loja ou apagado) 401; CSRF 403.
 */
export async function denyUnlessCustomer(req: Request): Promise<CustomerCtx | NextResponse> {
  const host = req.headers.get(STORE_HOST_HEADER);
  const store = host ? await resolveStoreByHost(host, platformDomain()) : null;
  if (!store) return err(404, "Não encontrado.");
  if (isStoreBlocked(store)) return err(403, "STORE_UNAVAILABLE");
  let customerId: string;
  try {
    customerId = (await requireCustomer(store.id)).user.id;
  } catch (e) {
    if (isRedirectError(e)) return err(401, "Não autenticado.");
    throw e;
  }
  const csrf = assertSameOriginJson(req) as NextResponse | null;
  return csrf ?? { store, customerId };
}
