import { PAGE_SIZE, getFilterOptions, isStoreOpen, listProducts, parseCatalogFilters } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Filters, Pagination, ProductGrid, type SP, Unavailable, toSearchParams } from "../catalog-view";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const sp = toSearchParams(await searchParams);
  const f = parseCatalogFilters(sp);
  const [{ items, total, page }, settings, options] = await Promise.all([listProducts(store.id, f), getSettings(store.id), getFilterOptions(store.id)]);
  sp.delete("page");
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>{f.q ? `Resultados para "${f.q}"` : "Todos os produtos"}</h1>
      <Filters action="/buscar" f={f} options={options} />
      <p>{total} {total === 1 ? "produto" : "produtos"}</p>
      <ProductGrid items={items} pixPercent={settings.pixDiscountPercent} />
      <Pagination basePath="/buscar" sp={sp} page={page} total={total} pageSize={PAGE_SIZE} />
    </main>
  );
}
