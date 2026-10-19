import { z } from "zod";
import { StoreStatus } from "@prisma/client";

// z.enum com os valores reais: `constructor`/`__proto__` nao passam (indexar o enum por chave deixaria passar).
const Query = z.object({
  status: z.enum(Object.values(StoreStatus) as [StoreStatus, ...StoreStatus[]]).optional(),
  planId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
});
export type StoreQuery = z.infer<typeof Query>;

/** Vazio = ausente. Valor invalido (page 0/-1/1e12/Infinity/NaN, status desconhecido) -> null (API responde 400; a pagina ignora os filtros). */
export function parseStoreQuery(sp: URLSearchParams | Record<string, string | undefined>): StoreQuery | null {
  const get = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) || undefined;
  const r = Query.safeParse({ status: get("status"), planId: get("planId"), q: get("q"), page: get("page") });
  return r.success ? r.data : null;
}
