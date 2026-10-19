import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbForStore, type StoreDb } from "@/lib/db-store";
import { getStorage, isOwnImageUrl } from "@/integrations/storage";
import { assertCanAddProduct } from "./entitlements";
import { slugify } from "./slug";
import { MAX_VARIANTS, OPTION_MAX } from "./variants";

export type ProductErrorCode =
  | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND" | "CATEGORY_INVALID" | "SLUG_INVALID" | "SLUG_TAKEN" | "SKU_TAKEN" | "VARIANT_EXISTS"
  | "NO_ACTIVE_VARIANT" | "LAST_ACTIVE_VARIANT" | "PRODUCT_HAS_ORDERS" | "IMAGE_URL_INVALID"
  | "IMAGE_COLOR_INVALID" | "TOO_MANY_VARIANTS";

const STATUS: Record<ProductErrorCode, 400 | 404 | 409> = {
  PRODUCT_NOT_FOUND: 404, VARIANT_NOT_FOUND: 404, SLUG_TAKEN: 409, SKU_TAKEN: 409, VARIANT_EXISTS: 409, PRODUCT_HAS_ORDERS: 409,
  CATEGORY_INVALID: 400, SLUG_INVALID: 400, NO_ACTIVE_VARIANT: 400, LAST_ACTIVE_VARIANT: 400,
  IMAGE_URL_INVALID: 400, IMAGE_COLOR_INVALID: 400, TOO_MANY_VARIANTS: 400,
};

/** Erro de regra de produto/variacao; a rota responde `status` com `{ error: code }`. */
export class ProductError extends Error {
  name = "ProductError";
  readonly status: 400 | 404 | 409;
  constructor(readonly code: ProductErrorCode) {
    super(code);
    this.status = STATUS[code];
  }
}

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const option = z.string().trim().min(1).max(OPTION_MAX);
const VariantFields = z.object({
  color: option,
  size: option,
  sku: z.string().trim().regex(/^[A-Za-z0-9._-]{1,60}$/),
  priceCents: int(1, 100_000_000),
  stock: int(0, 1_000_000),
  active: z.boolean(),
});
export const VariantCreate = VariantFields.extend({ active: z.boolean().default(true) });
export const VariantPatch = VariantFields.partial();
export type VariantCreateInput = z.input<typeof VariantCreate>;

const ImageItem = z.object({ url: z.string().max(500), color: z.string().trim().max(OPTION_MAX).nullish().transform((v) => v || null) });
const Images = z.array(ImageItem).max(10);
// Peso e dimensoes nos limites dos Correios (30 kg, 105 cm por lado).
const ProductFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(5000),
  categoryId: z.string().min(1).max(64),
  active: z.boolean(),
  weightGrams: int(1, 30_000),
  heightCm: int(1, 105),
  widthCm: int(1, 105),
  lengthCm: int(1, 105),
});
export const ProductCreate = ProductFields.extend({
  description: z.string().max(5000).default(""),
  active: z.boolean().default(true),
  variants: z.array(VariantCreate).max(MAX_VARIANTS).default([]),
  images: Images.default([]),
});
export const ProductPatch = ProductFields.partial().extend({ images: Images.optional() });
export type ProductCreateInput = z.input<typeof ProductCreate>;
export type ProductPatchInput = z.input<typeof ProductPatch>;

export type Tx = Parameters<Parameters<StoreDb["$transaction"]>[0]>[0];

/** Violacao de unicidade do banco -> erro de dominio (o banco e a palavra final em corrida). */
export function uniqueToProductError(e: unknown): unknown {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return e;
  const target = String(e.meta?.target ?? "");
  if (target.includes("sku")) return new ProductError("SKU_TAKEN");
  if (target.includes("color")) return new ProductError("VARIANT_EXISTS");
  if (target.includes("slug")) return new ProductError("SLUG_TAKEN");
  return e;
}
export const isFkError = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";

const lower = (s: string) => s.toLowerCase();
/** SKU e (cor, tamanho) repetidos dentro da mesma lista. */
export function checkVariantList(vs: { sku: string; color: string; size: string }[]): void {
  if (new Set(vs.map((v) => v.sku)).size !== vs.length) throw new ProductError("SKU_TAKEN");
  if (new Set(vs.map((v) => `${lower(v.color)}\u0000${lower(v.size)}`)).size !== vs.length) throw new ProductError("VARIANT_EXISTS");
}

function productSlug(name: string): string {
  const slug = slugify(name).slice(0, 80).replace(/-+$/, "");
  if (!slug) throw new ProductError("SLUG_INVALID");
  return slug;
}

/** URL emitida para esta loja e cor igual a de uma variacao (grava a grafia da variacao). Posicao = ordem da lista. */
function imageRows(storeId: string, productId: string, images: z.output<typeof Images>, colors: string[]) {
  const storage = getStorage();
  return images.map((im, position) => {
    if (!isOwnImageUrl(storage, storeId, im.url)) throw new ProductError("IMAGE_URL_INVALID");
    let color: string | null = null;
    if (im.color) {
      color = colors.find((c) => lower(c) === lower(im.color!)) ?? null;
      if (!color) throw new ProductError("IMAGE_COLOR_INVALID");
    }
    return { storeId, productId, url: im.url, color, position };
  });
}

async function assertCategory(tx: Tx, id: string): Promise<void> {
  if (!(await tx.category.findUnique({ where: { id }, select: { id: true } }))) throw new ProductError("CATEGORY_INVALID");
}

// Remocao no armazenamento e posterior ao commit e melhor-esforco: falha deixa arquivo orfao, nunca dado inconsistente.
// URL ainda usada por outra imagem (mesmo arquivo em dois produtos) fica.
async function removeImages(storeId: string, urls: string[]): Promise<void> {
  if (!urls.length) return;
  const storage = getStorage();
  const db = dbForStore(storeId);
  await Promise.all([...new Set(urls)].map(async (u) => {
    if (await db.productImage.count({ where: { url: u } })) return;
    await storage.remove(u).catch((e) => console.error("Falha ao remover imagem", u, e));
  }));
}

const FULL = { variants: { orderBy: [{ color: "asc" }, { size: "asc" }] }, images: { orderBy: { position: "asc" } } } satisfies Prisma.ProductInclude;

export async function getProduct(storeId: string, id: string) {
  const p = await dbForStore(storeId).product.findUnique({ where: { id }, include: FULL });
  if (!p) throw new ProductError("PRODUCT_NOT_FOUND");
  return p;
}

/** Produto + variacoes + imagens numa transacao so (tudo ou nada), com o limite do plano checado sob a trava da loja. */
export async function createProduct(storeId: string, input: ProductCreateInput) {
  const data = ProductCreate.parse(input);
  checkVariantList(data.variants);
  if (data.active && !data.variants.some((v) => v.active)) throw new ProductError("NO_ACTIVE_VARIANT");
  const slug = productSlug(data.name);
  const { variants, images, ...fields } = data;
  try {
    return await dbForStore(storeId).$transaction(async (tx) => {
      await assertCategory(tx, data.categoryId);
      await assertCanAddProduct(storeId, tx);
      const p = await tx.product.create({ data: { ...fields, storeId, slug } });
      const rows = imageRows(storeId, p.id, images, variants.map((v) => v.color));
      if (variants.length) await tx.variant.createMany({ data: variants.map((v) => ({ ...v, storeId, productId: p.id })) });
      if (rows.length) await tx.productImage.createMany({ data: rows });
      return tx.product.findUniqueOrThrow({ where: { id: p.id }, include: FULL });
    }, { lockStore: true });
  } catch (e) {
    throw uniqueToProductError(e);
  }
}

export async function updateProduct(storeId: string, id: string, input: ProductPatchInput) {
  const { images, ...data } = ProductPatch.parse(input);
  let dropped: string[] = [];
  try {
    const result = await dbForStore(storeId).$transaction(async (tx) => {
      const p = await tx.product.findUnique({ where: { id }, include: { variants: { select: { color: true, active: true } }, images: true } });
      if (!p) throw new ProductError("PRODUCT_NOT_FOUND");
      if (data.categoryId !== undefined) await assertCategory(tx, data.categoryId);
      if (data.active === true && !p.variants.some((v) => v.active)) throw new ProductError("NO_ACTIVE_VARIANT");
      if (images) {
        const rows = imageRows(storeId, id, images, p.variants.map((v) => v.color));
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (rows.length) await tx.productImage.createMany({ data: rows });
        dropped = p.images.map((i) => i.url).filter((u) => !rows.some((r) => r.url === u));
      }
      // Slug fixo desde a criacao: renomear nao quebra links publicos da vitrine.
      return tx.product.update({ where: { id }, data, include: FULL });
    }, { lockStore: true });
    await removeImages(storeId, dropped);
    return result;
  } catch (e) {
    throw uniqueToProductError(e);
  }
}

/** Produto com pedidos nao sai (historico): o lojista desativa. Sem pedidos, variacoes e imagens vao junto (cascata). */
export async function deleteProduct(storeId: string, id: string): Promise<void> {
  let urls: string[] = [];
  try {
    await dbForStore(storeId).$transaction(async (tx) => {
      const p = await tx.product.findUnique({ where: { id }, include: { variants: { select: { id: true } }, images: { select: { url: true } } } });
      if (!p) throw new ProductError("PRODUCT_NOT_FOUND");
      if (await tx.orderItem.count({ where: { variantId: { in: p.variants.map((v) => v.id) } } })) throw new ProductError("PRODUCT_HAS_ORDERS");
      await tx.product.delete({ where: { id } });
      urls = p.images.map((i) => i.url);
    }, { lockStore: true });
  } catch (e) {
    throw isFkError(e) ? new ProductError("PRODUCT_HAS_ORDERS") : e;
  }
  await removeImages(storeId, urls);
}

export const PAGE_SIZE = 25;
const Query = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});
export type ProductQuery = z.output<typeof Query>;

/** Vazio = ausente. Valor invalido -> null (API responde 400; a pagina ignora os filtros). */
export function parseProductQuery(sp: URLSearchParams | Record<string, string | string[] | undefined>): ProductQuery | null {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const r = Query.safeParse({ page: get("page"), q: get("q"), categoryId: get("categoryId"), active: get("active") });
  if (!r.success) return null;
  return Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== undefined && v !== "")) as ProductQuery;
}

export async function listProducts(storeId: string, query: ProductQuery) {
  const page = query.page ?? 1;
  const and: Prisma.ProductWhereInput[] = [];
  if (query.q) {
    and.push({ OR: [{ name: { contains: query.q, mode: "insensitive" } }, { variants: { some: { sku: { contains: query.q, mode: "insensitive" } } } }] });
  }
  if (query.categoryId) and.push({ categoryId: query.categoryId });
  if (query.active !== undefined) and.push({ active: query.active });
  const db = dbForStore(storeId);
  const [rows, total] = await Promise.all([
    db.product.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: { select: { name: true } }, variants: { select: { priceCents: true, stock: true } }, images: { orderBy: { position: "asc" }, take: 1 } },
    }),
    db.product.count({ where: { AND: and } }),
  ]);
  const items = rows.map(({ category, variants, images, ...p }) => ({
    ...p,
    categoryName: category?.name ?? null,
    variantCount: variants.length,
    minPriceCents: variants.length ? Math.min(...variants.map((v) => v.priceCents)) : null,
    totalStock: variants.reduce((s, v) => s + v.stock, 0),
    imageUrl: images[0]?.url ?? null,
  }));
  return { items, total, page, pageSize: PAGE_SIZE };
}
