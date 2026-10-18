import { notFound } from "next/navigation";
import { PAGE_SIZE, getCategoryBySlug, getFilterOptions, isStoreOpen, listProducts, parseCatalogFilters } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Filters, Pagination, ProductGrid, type SP, Unavailable, toSearchParams } from "../../catalog-view";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const { slug } = await params;
  const category = await getCategoryBySlug(store.id, slug);
  if (!category) notFound();
  const sp = toSearchParams(await searchParams);
  sp.delete("category"); // a categoria vem do caminho
  const f = { ...parseCatalogFilters(sp), category: category.slug };
  const [{ items, total }, settings, options] = await Promise.all([listProducts(store.id, f), getSettings(store.id), getFilterOptions(store.id)]);
  sp.delete("page");
  const path = `/c/${category.slug}`;
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>{category.name}</h1>
      <Filters action={path} f={f} options={options} />
      <p>{total} {total === 1 ? "produto" : "produtos"}</p>
      <ProductGrid items={items} pixPercent={settings.pixDiscountPercent} />
      <Pagination basePath={path} sp={sp} page={f.page} total={total} pageSize={PAGE_SIZE} />
    </main>
  );
}
