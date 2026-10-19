import { Prisma } from "@prisma/client";
import { prisma } from "./db";

// Codigo de seguranca: unica porta de acesso aos dados de loja. Ver testes em db-store.test.ts.
export const STORE_MODELS = [
  "Customer",
  "Address",
  "Category",
  "Product",
  "ProductImage",
  "Variant",
  "Order",
  "OrderItem",
  "StoreSetting",
] as const;

type Accessor<S extends string> = S extends `${infer F}${infer R}` ? `${Lowercase<F>}${R}` : S;
type StoreModelKey = Accessor<(typeof STORE_MODELS)[number]>;
const KEYS = STORE_MODELS.map((m) => m[0].toLowerCase() + m.slice(1)) as StoreModelKey[];

export class StoreScopeError extends Error {
  name = "StoreScopeError";
}

const RELATIONS = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.filter((f) => f.kind === "object").map((f) => f.name))]),
);

const WHERE_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);
const UPDATE_OPS = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);
const KNOWN_OPS = new Set([...WHERE_OPS, ...CREATE_OPS]);

type Args = Record<string, unknown>;
const isPlain = (v: unknown): v is Args =>
  typeof v === "object" && v !== null && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const LEAF_TYPES = [Date, Prisma.Decimal, Uint8Array, ...Object.values(Prisma.NullTypes)];

// Copia profunda em objetos simples: cada getter e lido uma vez, e checagem e uso veem o mesmo valor.
// Objetos de classe fora da lista sao recusados (falha fechada: nao sabemos como o Prisma os le).
function snapshot(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(snapshot);
  if (typeof v !== "object" || v === null) return v;
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, snapshot(x)]));
  if (LEAF_TYPES.some((T) => v instanceof T)) return v;
  throw new StoreScopeError("Argumento de tipo nao suportado no cliente da loja");
}

// A relacao `store` leva a Store -> Plan -> stores (todas as lojas): bloqueada em leitura e filtro.
function rejectStoreRelation(v: unknown): void {
  if (Array.isArray(v)) return v.forEach(rejectStoreRelation);
  if (typeof v !== "object" || v === null) return;
  for (const [k, inner] of Object.entries(v)) {
    if (k === "store") throw new StoreScopeError("Relacao `store` nao e acessivel pelo cliente da loja; use getCurrentStore()");
    rejectStoreRelation(inner);
  }
}

function checkData(storeId: string, model: string, data: unknown, isCreate: boolean): unknown {
  if (Array.isArray(data)) return data.map((d) => checkData(storeId, model, d, isCreate));
  if (!isPlain(data)) throw new StoreScopeError(`Dados invalidos em ${model}`);
  const rel = RELATIONS.get(model)!;
  for (const k of Object.keys(data)) {
    // Escrita aninhada (create/connect/...) poderia ligar linhas de outra loja: o chamador escreve cada modelo separado.
    if (rel.has(k)) throw new StoreScopeError(`Escrita aninhada em ${model}.${k} nao e permitida no cliente da loja`);
  }
  if (data.storeId !== undefined && data.storeId !== storeId) {
    throw new StoreScopeError(`storeId diferente da loja atual em ${model} (escrita em outra loja bloqueada)`);
  }
  return isCreate ? { ...data, storeId } : data;
}

function scopeArgs(storeId: string, model: string, operation: string, raw: unknown): Args {
  if (!STORE_MODELS.includes(model as never)) throw new StoreScopeError(`Modelo ${model} nao e de loja`);
  if (!KNOWN_OPS.has(operation)) throw new StoreScopeError(`Operacao ${operation} nao suportada no cliente da loja`);
  const args = snapshot(raw ?? {}) as Args;
  for (const k of ["where", "include", "select", "orderBy", "having", "cursor"]) rejectStoreRelation(args[k]);

  if (WHERE_OPS.has(operation)) {
    // Spread + AND vale tambem para WhereUniqueInput (filtros extras sao aceitos desde o Prisma 5).
    const where = (args.where as Args | undefined) ?? {};
    args.where = { ...where, AND: [...list(where.AND), { storeId }] };
  }
  // Cursor de outra loja nao casa: a pagina sai vazia em vez de revelar a posicao da linha alheia.
  if (args.cursor) args.cursor = { ...(args.cursor as Args), storeId };
  if (operation === "upsert") {
    args.create = checkData(storeId, model, args.create, true);
    args.update = checkData(storeId, model, args.update, false);
  } else if (CREATE_OPS.has(operation)) {
    args.data = checkData(storeId, model, args.data, true);
  } else if (UPDATE_OPS.has(operation)) {
    args.data = checkData(storeId, model, args.data, false);
  }
  return args;
}

function extend(storeId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(storeId, model, operation, args));
        },
      },
    },
  });
}

type Ext = ReturnType<typeof extend>;
type Op = "findUnique" | "findUniqueOrThrow" | "findFirst" | "findFirstOrThrow" | "findMany" | "count" | "aggregate"
  | "groupBy" | "create" | "createMany" | "createManyAndReturn" | "update" | "updateMany" | "updateManyAndReturn"
  | "upsert" | "delete" | "deleteMany";
type Scoped = { [K in StoreModelKey]: Pick<Ext[K], Op & keyof Ext[K]> };
export type TxOptions = {
  /** Trava a linha da Store (FOR UPDATE) antes de `fn`: serializa leitura+checagem+escrita entre requisicoes da mesma loja (limites de plano, arvore de categorias). */
  lockStore?: boolean;
  /** Tempo maximo da transacao (padrao do Prisma: 5s). */
  timeoutMs?: number;
};
export type StoreDb = Scoped & { $transaction<T>(fn: (tx: Scoped) => Promise<T>, opts?: TxOptions): Promise<T> };

// So funcoes novas por operacao: o delegate do Prisma tem `$parent` (cliente base, sem escopo).
const pick = (c: Pick<Ext, StoreModelKey>) =>
  Object.fromEntries(
    KEYS.map((k) => {
      const d = c[k] as unknown as Record<string, (a: unknown) => unknown>;
      return [k, Object.fromEntries([...KNOWN_OPS].map((op) => [op, (a: unknown) => d[op](a)]))];
    }),
  ) as unknown as Scoped;

/** Cliente escopado a uma loja: so modelos de loja, sem SQL bruto nem modelos de plataforma. */
export function dbForStore(storeId: string): StoreDb {
  if (!storeId) throw new StoreScopeError("storeId obrigatorio");
  const ext = extend(storeId);
  return {
    ...pick(ext),
    // O callback so recebe o cliente escopado (sem $queryRaw nem $parent); o SQL da trava e fixo e parametrizado.
    $transaction: (fn, opts) =>
      ext.$transaction(async (tx) => {
        if (opts?.lockStore) await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
        return fn(pick(tx));
      }, opts?.timeoutMs ? { timeout: opts.timeoutMs } : undefined),
  };
}
