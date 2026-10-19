import { cache } from "react";
import { notFound } from "next/navigation";
import { PAGE_SIZE, getCategoryBySlug as findCategory, getFilterOptions, isStoreOpen, listProducts, parseCatalogFilters } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Filters, Pagination, ProductGrid, type SP, Unavailable, toSearchParams } from "../../catalog-view";

export const dynamic = "force-dynamic";

const getCategoryBySlug = cache(findCategory); // metadata e pagina na mesma requisicao: uma consulta so

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const store = await getCurrentStore();
  const category = isStoreOpen(store) ? await getCategoryBySlug(store.id, (await params).slug) : null;
  if (!category) return {};
  return { title: `${category.name} | ${store.name}`, description: `${category.name} na ${store.name}` };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const { slug } = await params;
  const category = await getCategoryBySlug(store.id, slug);
  if (!category) notFound();
  const sp = toSearchParams(await searchParams);
  sp.delete("category"); // a categoria vem do caminho
  const f = { ...parseCatalogFilters(sp), category: category.slug };
  const [{ items, total, page }, settings, options] = await Promise.all([listProducts(store.id, f), getSettings(store.id), getFilterOptions(store.id)]);
  sp.delete("page");
  const path = `/c/${category.slug}`;
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>{category.name}</h1>
      <Filters action={path} f={f} options={options} />
      <p>{total} {total === 1 ? "produto" : "produtos"}</p>
      <ProductGrid items={items} pixPercent={settings.pixDiscountPercent} />
      <Pagination basePath={path} sp={sp} page={page} total={total} pageSize={PAGE_SIZE} />
    </main>
  );
}
