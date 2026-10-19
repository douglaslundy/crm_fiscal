import { dbForStore } from "@/lib/db-store";
import type { ProductCard } from "./catalog";

export class WishlistError extends Error {
  name = "WishlistError";
  constructor(readonly status: 404 | 409, readonly code: "PRODUCT_NOT_FOUND" | "WISHLIST_FULL") {
    super(code);
  }
}

export const WISHLIST_MAX = 200;

/** Idempotente. Produto inexistente, inativo ou de outra loja = PRODUCT_NOT_FOUND. */
export async function addToWishlist(storeId: string, customerId: string, productId: string): Promise<void> {
  const db = dbForStore(storeId);
  if (!(await db.product.findFirst({ where: { id: productId, active: true }, select: { id: true } }))) throw new WishlistError(404, "PRODUCT_NOT_FOUND");
  await db.$transaction(async (tx) => {
    if (await tx.wishlistItem.findFirst({ where: { customerId, productId }, select: { productId: true } })) return;
    if ((await tx.wishlistItem.count({ where: { customerId } })) >= WISHLIST_MAX) throw new WishlistError(409, "WISHLIST_FULL");
    await tx.wishlistItem.create({ data: { storeId, customerId, productId } });
  }, { lockStore: true });
}

export async function removeFromWishlist(storeId: string, customerId: string, productId: string): Promise<void> {
  await dbForStore(storeId).wishlistItem.deleteMany({ where: { customerId, productId } });
}

export async function isInWishlist(storeId: string, customerId: string, productId: string): Promise<boolean> {
  return !!(await dbForStore(storeId).wishlistItem.findFirst({ where: { customerId, productId }, select: { productId: true } }));
}

/** Favoritos ativos com variacao ativa, do mais recente ao mais antigo, no formato dos cards da vitrine. */
export async function listWishlist(storeId: string, customerId: string): Promise<ProductCard[]> {
  const rows = await dbForStore(storeId).product.findMany({
    where: { active: true, variants: { some: { active: true } }, wishlisted: { some: { customerId } } },
    select: {
      id: true, slug: true, name: true,
      variants: { where: { active: true }, select: { priceCents: true, stock: true } },
      images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
      wishlisted: { where: { customerId }, select: { createdAt: true } },
    },
    take: WISHLIST_MAX,
  });
  return rows
    .sort((a, b) => b.wishlisted[0].createdAt.getTime() - a.wishlisted[0].createdAt.getTime() || (a.id < b.id ? -1 : 1))
    .map(({ id, slug, name, variants, images }) => {
      const stock = variants.reduce((s, v) => s + v.stock, 0);
      return { id, slug, name, imageUrl: images[0]?.url ?? null, minPriceCents: Math.min(...variants.map((v) => v.priceCents)), soldOut: stock === 0, lastUnit: stock === 1 };
    });
}
