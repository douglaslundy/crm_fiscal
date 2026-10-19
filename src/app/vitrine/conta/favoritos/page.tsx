import Link from "next/link";
import { isStoreOpen } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { listWishlist } from "@/domain/wishlist";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { ProductGrid, Unavailable } from "../../catalog-view";

export const dynamic = "force-dynamic";

/** Favoritos do cliente logado nesta loja. */
export default async function WishlistPage() {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, "/conta/favoritos")).user.id;
  const [items, settings] = await Promise.all([listWishlist(store.id, customerId), getSettings(store.id)]);
  return (
    <main style={{ padding: "16px 0", display: "grid", gap: 12 }}>
      <h1>Meus favoritos</h1>
      <Link href="/conta">Meus pedidos</Link>
      {items.length === 0 ? <p>Você ainda não favoritou nenhum produto.</p> : <ProductGrid items={items} pixPercent={settings.pixDiscountPercent} />}
    </main>
  );
}
