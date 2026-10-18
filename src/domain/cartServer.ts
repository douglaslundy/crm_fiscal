import { dbForStore } from "@/lib/db-store";
import { priceCart, type CartLine, type VariantRow } from "./cart";

/** Carrega as variacoes da loja (so de produto ativo) e precifica: preco/estoque sempre do banco. Compartilhado por /api/cart/price e /api/shipping/quote. */
export async function priceStoreCart(storeId: string, lines: CartLine[]) {
  const rows = await dbForStore(storeId).variant.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.variantId))] }, product: { active: true } },
    select: {
      id: true, productId: true, color: true, size: true, sku: true, priceCents: true, stock: true, active: true,
      product: { select: { name: true, images: { orderBy: { position: "asc" }, select: { url: true, color: true } } } },
    },
  });
  const variants: VariantRow[] = rows.map(({ product, ...v }) => ({
    ...v,
    productName: product.name,
    imageUrl: (product.images.find((i) => i.color === v.color) ?? product.images[0])?.url ?? null,
  }));
  return priceCart(lines, variants);
}
