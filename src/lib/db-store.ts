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
const isPlain = (v: unknown): v is Args => !!v && Object.getPrototypeOf(v) === Object.prototype;
const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

// A relacao `store` leva a Store -> Plan -> stores (todas as lojas): bloqueada em leitura e filtro.
function rejectStoreRelation(v: unknown): void {
  if (Array.isArray(v)) return v.forEach(rejectStoreRelation);
  if (!isPlain(v)) return;
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
  const args: Args = { ...((raw as Args) ?? {}) };
  for (const k of ["where", "include", "select", "orderBy", "having"]) rejectStoreRelation(args[k]);

  if (WHERE_OPS.has(operation)) {
    // Spread + AND vale tambem para WhereUniqueInput (filtros extras sao aceitos desde o Prisma 5).
    const where = (args.where as Args | undefined) ?? {};
    args.where = { ...where, AND: [...list(where.AND), { storeId }] };
  }
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

type Scoped = Pick<ReturnType<typeof extend>, StoreModelKey>;
export type StoreDb = Scoped & { $transaction<T>(fn: (tx: Scoped) => Promise<T>): Promise<T> };

const pick = (c: Scoped) => Object.fromEntries(KEYS.map((k) => [k, c[k]])) as Scoped;

/** Cliente escopado a uma loja: so modelos de loja, sem SQL bruto nem modelos de plataforma. */
export function dbForStore(storeId: string): StoreDb {
  if (!storeId) throw new StoreScopeError("storeId obrigatorio");
  const ext = extend(storeId);
  return { ...pick(ext), $transaction: (fn) => ext.$transaction((tx) => fn(pick(tx))) };
}
