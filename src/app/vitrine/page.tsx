import { PAGE_SIZE, isStoreOpen, listProducts, parseCatalogFilters } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Pagination, ProductGrid, type SP, Unavailable, toSearchParams } from "./catalog-view";

export const dynamic = "force-dynamic";

export default async function VitrineHome({ searchParams }: { searchParams: Promise<SP> }) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const sp = toSearchParams(await searchParams);
  const f = parseCatalogFilters(new URLSearchParams({ page: sp.get("page") ?? "1" })); // home: so novidades, sem filtros
  const [{ items, total }, settings] = await Promise.all([listProducts(store.id, f), getSettings(store.id)]);
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>Novidades</h1>
      <ProductGrid items={items} pixPercent={settings.pixDiscountPercent} />
      <Pagination basePath="/" sp={new URLSearchParams()} page={f.page} total={total} pageSize={PAGE_SIZE} />
    </main>
  );
}
