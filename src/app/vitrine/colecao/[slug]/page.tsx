import { cache } from "react";
import { notFound } from "next/navigation";
import { PAGE_SIZE, getFilterOptions, isStoreOpen, listProducts, parseCatalogFilters } from "@/domain/catalog";
import { getCollectionBySlug as findCollection } from "@/domain/collections";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Filters, Pagination, ProductGrid, type SP, Unavailable, toSearchParams } from "../../catalog-view";

export const dynamic = "force-dynamic";

const getCollectionBySlug = cache(findCollection); // metadata e pagina na mesma requisicao: uma consulta so

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const store = await getCurrentStore();
  const collection = isStoreOpen(store) ? await getCollectionBySlug(store.id, (await params).slug) : null;
  if (!collection) return {};
  return { title: `${collection.name} | ${store.name}`, description: `${collection.name} na ${store.name}` };
}

export default async function CollectionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const { slug } = await params;
  const collection = await getCollectionBySlug(store.id, slug);
  if (!collection) notFound();
  const sp = toSearchParams(await searchParams);
  sp.delete("collection"); // a colecao vem do caminho
  const f = { ...parseCatalogFilters(sp), collection: collection.slug };
  const [{ items, total, page }, settings, options] = await Promise.all([listProducts(store.id, f), getSettings(store.id), getFilterOptions(store.id)]);
  sp.delete("page");
  const path = `/colecao/${collection.slug}`;
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>{collection.name}</h1>
      <Filters action={path} f={f} options={options} />
      <p>{total} {total === 1 ? "produto" : "produtos"}</p>
      <ProductGrid items={items} pixPercent={settings.pixDiscountPercent} />
      <Pagination basePath={path} sp={sp} page={page} total={total} pageSize={PAGE_SIZE} />
    </main>
  );
}
