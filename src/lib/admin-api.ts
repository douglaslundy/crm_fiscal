import { NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { MemberRole, Store } from "@prisma/client";
import type { Session } from "next-auth";
import { getSession } from "@/auth";
import { isStoreBlocked } from "@/domain/subscription";
import { STORE_HOST_HEADER, platformDomain } from "./host";
import { requireStoreMember } from "./guards";
import { assertSameOriginJson } from "./csrf";
import { err } from "./master-api";
import { getCurrentStore, resolveStoreByHost } from "./tenant";

export type AdminOpts = { role?: Extract<MemberRole, "OWNER"> };
export type AdminCtx = { store: Store; session: Session };

/**
 * Pagina /admin: host da plataforma ou loja desconhecida 404; requireStoreMember redireciona para /entrar quem nao e
 * membro desta loja (master passa). Loja SUSPENDED/CANCELED e so leitura: a pagina deve desabilitar/ocultar formularios (readOnly).
 * Toda page.tsx de src/app/admin chama isto na primeira linha; o layout nao protege nada.
 */
export async function adminPage(opts: AdminOpts = {}): Promise<AdminCtx & { readOnly: boolean }> {
  const store = await getCurrentStore();
  const session = await requireStoreMember(store.id, opts.role);
  return { store, session, readOnly: isStoreBlocked(store) };
}

/**
 * Route handler /api/admin/**: devolve `{ store, session }` ou a resposta de recusa. Ordem: sem host de loja 404;
 * loja desconhecida 404; sem sessao 401; nao e membro desta loja (cliente, conta de outra loja, papel insuficiente) 403;
 * metodo que muda estado: CSRF 403; `write` em loja suspensa/cancelada 403 STORE_SUSPENDED (leituras continuam).
 * A permissao e relida do banco a cada chamada (requireStoreMember).
 */
export async function denyUnlessStoreMember(req: Request, opts: AdminOpts & { write?: boolean } = {}): Promise<AdminCtx | NextResponse> {
  const host = req.headers.get(STORE_HOST_HEADER);
  const store = host ? await resolveStoreByHost(host, platformDomain()) : null;
  if (!store) return err(404, "Não encontrado.");
  if (!(await getSession())) return err(401, "Não autenticado.");
  let session: Session;
  try {
    session = await requireStoreMember(store.id, opts.role);
  } catch (e) {
    if (isRedirectError(e)) return err(403, "Acesso negado.");
    throw e;
  }
  // CSRF depois da autenticacao: quem nao e membro recebe 401/403 sem aprender nada sobre a defesa.
  const csrf = assertSameOriginJson(req) as NextResponse | null;
  if (csrf) return csrf;
  if (opts.write && isStoreBlocked(store)) return err(403, "STORE_SUSPENDED");
  return { store, session };
}

export const denied = (r: AdminCtx | NextResponse): r is NextResponse => r instanceof NextResponse;
