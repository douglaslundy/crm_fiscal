import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbForStore } from "@/lib/db-store";
import { slugify } from "./slug";

export type CollectionErrorCode = "COLLECTION_INVALID" | "COLLECTION_NOT_FOUND" | "COLLECTION_SLUG_TAKEN" | "PRODUCT_NOT_FOUND";

export class CollectionError extends Error {
  name = "CollectionError";
  constructor(readonly status: 400 | 404 | 409, readonly code: CollectionErrorCode) {
    super(code);
  }
}

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/;
export const MAX_COLLECTION_PRODUCTS = 500;

// slug "" = automatico (criar) / inalterado (editar)
export const CollectionBody = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().optional().transform((v) => v || undefined),
  active: z.boolean().optional(),
});
export type CollectionInput = { name: string; slug?: string; active?: boolean };
export const CollectionPatch = CollectionBody.partial();
export const CollectionProducts = z.object({ productIds: z.array(z.string().max(64)).max(MAX_COLLECTION_PRODUCTS) });

const SELECT = { id: true, slug: true, name: true, active: true } as const;
const code = (e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined);
const cleanSlug = (s: string) => {
  if (!SLUG_RE.test(s)) throw new CollectionError(400, "COLLECTION_INVALID");
  return s;
};

export async function listCollections(storeId: string) {
  const rows = await dbForStore(storeId).collection.findMany({
    select: { ...SELECT, _count: { select: { products: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
}

export async function createCollection(storeId: string, input: CollectionInput) {
  const slug = cleanSlug(input.slug ?? slugify(input.name));
  try {
    return await dbForStore(storeId).collection.create({ data: { storeId, name: input.name, slug, active: input.active ?? true }, select: SELECT });
  } catch (e) {
    if (code(e) === "P2002") throw new CollectionError(409, "COLLECTION_SLUG_TAKEN");
    throw e;
  }
}

export async function updateCollection(storeId: string, id: string, patch: Partial<CollectionInput>) {
  const data: Prisma.CollectionUncheckedUpdateManyInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.slug !== undefined) data.slug = cleanSlug(patch.slug);
  if (patch.active !== undefined) data.active = patch.active;
  const db = dbForStore(storeId);
  try {
    const { count } = await db.collection.updateMany({ where: { id }, data });
    if (count === 0) throw new CollectionError(404, "COLLECTION_NOT_FOUND");
  } catch (e) {
    if (code(e) === "P2002") throw new CollectionError(409, "COLLECTION_SLUG_TAKEN");
    throw e;
  }
  return db.collection.findFirstOrThrow({ where: { id }, select: SELECT });
}

export async function deleteCollection(storeId: string, id: string): Promise<void> {
  const { count } = await dbForStore(storeId).collection.deleteMany({ where: { id } });
  if (count === 0) throw new CollectionError(404, "COLLECTION_NOT_FOUND");
}

/** Produtos da colecao (admin): ids marcados, para o seletor. */
export async function collectionProductIds(storeId: string, id: string): Promise<string[]> {
  return (await dbForStore(storeId).productCollection.findMany({ where: { collectionId: id }, select: { productId: true } })).map((r) => r.productId);
}

/** Troca o conjunto de produtos da colecao (idempotente). Id de produto de outra loja = PRODUCT_NOT_FOUND, nada muda. */
export async function setCollectionProducts(storeId: string, id: string, productIds: string[]): Promise<void> {
  const ids = [...new Set(productIds)];
  await dbForStore(storeId).$transaction(async (tx) => {
    if (!(await tx.collection.findFirst({ where: { id }, select: { id: true } }))) throw new CollectionError(404, "COLLECTION_NOT_FOUND");
    if (ids.length && (await tx.product.count({ where: { id: { in: ids } } })) !== ids.length) throw new CollectionError(400, "PRODUCT_NOT_FOUND");
    await tx.productCollection.deleteMany({ where: { collectionId: id } });
    if (ids.length) await tx.productCollection.createMany({ data: ids.map((productId) => ({ storeId, collectionId: id, productId })) });
  });
}

/** Colecoes ativas (menu da vitrine). */
export const getActiveCollections = (storeId: string) =>
  dbForStore(storeId).collection.findMany({ where: { active: true, products: { some: {} } }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } });

export const getCollectionBySlug = (storeId: string, slug: string) =>
  dbForStore(storeId).collection.findFirst({ where: { slug, active: true }, select: { id: true, slug: true, name: true } });
