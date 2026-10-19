import { dbForStore, type StoreDb } from "@/lib/db-store";
import { priceCart, type CartLine, type VariantRow } from "./cart";

/** Variacoes da loja (so de produto ativo), com preco/estoque do banco. `db` = cliente escopado ou o `tx` de uma transacao dele. */
export async function loadVariantRows(db: Pick<StoreDb, "variant">, ids: string[]): Promise<VariantRow[]> {
  const rows = await db.variant.findMany({
    where: { id: { in: [...new Set(ids)] }, product: { active: true } },
    select: {
      id: true, productId: true, color: true, size: true, sku: true, priceCents: true, stock: true, active: true,
      product: { select: { name: true, images: { orderBy: { position: "asc" }, select: { url: true, color: true } } } },
    },
  });
  return rows.map(({ product, ...v }) => ({
    ...v,
    productName: product.name,
    imageUrl: (product.images.find((i) => i.color === v.color) ?? product.images[0])?.url ?? null,
  }));
}

/** Carrega as variacoes da loja e precifica: preco/estoque sempre do banco. Compartilhado por /api/cart/price e /api/shipping/quote. */
export async function priceStoreCart(storeId: string, lines: CartLine[]) {
  return priceCart(lines, await loadVariantRows(dbForStore(storeId), lines.map((l) => l.variantId)));
}
