import type { Prisma, Store } from "@prisma/client";
import { dbForStore } from "@/lib/db-store";

// Vitrine publica: so le, sempre por dbForStore (nenhum dado de outra loja aparece).

export const PAGE_SIZE = 24;
export const MAX_PAGE = 1000;
const Q_MAX = 80;

export type CatalogFilters = {
  category?: string;
  sizes: string[];
  colors: string[];
  minCents?: number;
  maxCents?: number;
  q?: string;
  page: number;
};

export type ProductCard = {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  minPriceCents: number;
  soldOut: boolean;
  lastUnit: boolean;
};

const cents = (v: string | null) => (v && /^\d{1,9}$/.test(v) ? Number(v) : undefined);
const values = (sp: URLSearchParams, k: string) => sp.getAll(k).map((v) => v.trim().slice(0, 40)).filter(Boolean).slice(0, 20);

/** Filtro invalido e ignorado (nunca erro): vitrine publica sempre responde. */
export function parseCatalogFilters(sp: URLSearchParams): CatalogFilters {
  const minCents = cents(sp.get("min"));
  let maxCents = cents(sp.get("max"));
  if (minCents !== undefined && maxCents !== undefined && minCents > maxCents) maxCents = undefined;
  const page = cents(sp.get("page"));
  const q = (sp.get("q") ?? "").trim().slice(0, Q_MAX) || undefined;
  const category = sp.get("category")?.trim() || undefined;
  const f: CatalogFilters = { sizes: values(sp, "size"), colors: values(sp, "color"), page: page && page >= 1 ? Math.min(page, MAX_PAGE) : 1 };
  if (category) f.category = category;
  if (minCents !== undefined) f.minCents = minCents;
  if (maxCents !== undefined) f.maxCents = maxCents;
  if (q) f.q = q;
  return f;
}

/** Ids da categoria pelo slug e de todas as descendentes; null se o slug nao existir na loja. */
async function categoryIds(storeId: string, slug: string): Promise<string[] | null> {
  const all = await dbForStore(storeId).category.findMany({ select: { id: true, parentId: true, slug: true } });
  const root = all.find((c) => c.slug === slug);
  if (!root) return null;
  const ids = new Set([root.id]);
  // Limitado ao total de categorias: ciclo em dado corrompido nao gira para sempre.
  for (let grew = true, n = 0; grew && n < all.length; n++) {
    grew = false;
    for (const c of all) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) grew = !!ids.add(c.id);
  }
  return [...ids];
}

const anyOf = (field: "size" | "color", vs: string[]): Prisma.VariantWhereInput[] =>
  vs.length ? [{ OR: vs.map((v) => ({ [field]: { equals: v, mode: "insensitive" } })) }] : [];

/** `page` devolvida = pagina realmente mostrada (pedido alem do fim cai na ultima). */
export async function listProducts(storeId: string, f: CatalogFilters): Promise<{ items: ProductCard[]; total: number; page: number }> {
  const and: Prisma.ProductWhereInput[] = [{ active: true }];
  if (f.category) {
    const ids = await categoryIds(storeId, f.category);
    if (!ids) return { items: [], total: 0, page: 1 };
    and.push({ categoryId: { in: ids } });
  }
  if (f.q) and.push({ name: { contains: f.q, mode: "insensitive" } });
  const variantMatch: Prisma.VariantWhereInput = {
    active: true,
    AND: [...anyOf("size", f.sizes), ...anyOf("color", f.colors)],
    priceCents: { gte: f.minCents, lte: f.maxCents },
  };
  and.push({ variants: { some: variantMatch } });
  const where = { AND: and };
  const db = dbForStore(storeId);
  const total = await db.product.count({ where });
  const page = Math.min(f.page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const rows = await db.product.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true, slug: true, name: true,
      variants: { where: { active: true }, select: { priceCents: true, stock: true } },
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
    },
  });
  const items = rows.map(({ variants, images, ...p }) => {
    const stock = variants.reduce((s, v) => s + v.stock, 0);
    return { ...p, imageUrl: images[0]?.url ?? null, minPriceCents: Math.min(...variants.map((v) => v.priceCents)), soldOut: stock === 0, lastUnit: stock === 1 };
  });
  return { items, total, page };
}

/** Produto ativo com variacoes ativas desta loja; null (pagina responde 404) caso contrario. */
export async function getProductBySlug(storeId: string, slug: string) {
  const p = await dbForStore(storeId).product.findFirst({
    where: { slug, active: true },
    include: {
      variants: { where: { active: true }, orderBy: [{ color: "asc" }, { size: "asc" }], select: { id: true, color: true, size: true, priceCents: true, stock: true } },
      images: { orderBy: { position: "asc" }, select: { url: true, color: true } },
    },
  });
  return p && p.variants.length ? p : null;
}

/** Categorias de topo com as subcategorias diretas (menu). */
export async function getMenu(storeId: string) {
  const all = await dbForStore(storeId).category.findMany({ orderBy: { name: "asc" }, select: { id: true, parentId: true, slug: true, name: true } });
  return all.filter((c) => !c.parentId).map((c) => ({ ...c, children: all.filter((k) => k.parentId === c.id) }));
}

export const isStoreOpen = (store: Pick<Store, "status">) => store.status === "TRIAL" || store.status === "ACTIVE";

const UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");
/** JSON para <script type="application/ld+json">: escapa o que poderia fechar a tag ou quebrar o script. */
export const jsonLdScript = (data: unknown): string =>
  JSON.stringify(data).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function productJsonLd(p: { name: string; description: string; images: { url: string }[]; variants: { priceCents: number; stock: number }[] }) {
  const price = Math.min(...p.variants.map((v) => v.priceCents));
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    image: p.images.map((i) => i.url),
    description: p.description,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: (price / 100).toFixed(2),
      availability: p.variants.some((v) => v.stock > 0) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };
}

/** Descricao para <meta>: espacos colapsados, ate 160 caracteres; vazia usa o fallback. */
export const metaDescription = (text: string | null | undefined, fallback: string) =>
  text?.replace(/\s+/g, " ").trim().slice(0, 160) || fallback;

export const getCategoryBySlug = (storeId: string, slug: string) =>
  dbForStore(storeId).category.findFirst({ where: { slug }, select: { id: true, slug: true, name: true } });

/** Tamanhos e cores de variacoes ativas de produtos ativos (opcoes do filtro). */
export async function getFilterOptions(storeId: string): Promise<{ sizes: string[]; colors: string[] }> {
  const db = dbForStore(storeId);
  const where = { active: true, product: { active: true } };
  const [sizes, colors] = await Promise.all([
    db.variant.findMany({ where, distinct: ["size"], orderBy: { size: "asc" }, select: { size: true } }),
    db.variant.findMany({ where, distinct: ["color"], orderBy: { color: "asc" }, select: { color: true } }),
  ]);
  return { sizes: sizes.map((v) => v.size), colors: colors.map((v) => v.color) };
}
