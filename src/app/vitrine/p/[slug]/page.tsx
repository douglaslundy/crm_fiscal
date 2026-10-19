import { cache } from "react";
import { notFound } from "next/navigation";
import { getProductBySlug as findProduct, isStoreOpen, jsonLdScript, metaDescription, productJsonLd } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../../catalog-view";
import { ProductOptions } from "./product-options";

export const dynamic = "force-dynamic";

const getProductBySlug = cache(findProduct); // metadata e pagina na mesma requisicao: uma consulta so
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const store = await getCurrentStore();
  const product = isStoreOpen(store) ? await getProductBySlug(store.id, (await params).slug) : null;
  if (!product) return {}; // fica o titulo do layout (nome da loja)
  return { title: `${product.name} | ${store.name}`, description: metaDescription(product.description, `${product.name} na ${store.name}`) };
}

export default async function ProductPage({ params }: Props) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const { slug } = await params;
  const product = await getProductBySlug(store.id, slug);
  if (!product) notFound(); // inexistente, inativo ou de outra loja: mesma resposta
  const { pixDiscountPercent } = await getSettings(store.id);
  return (
    <main style={{ padding: "16px 0" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product)) }} />
      <ProductOptions name={product.name} variants={product.variants} images={product.images} pixPercent={pixDiscountPercent} />
      {product.description && <section style={{ marginTop: 24, whiteSpace: "pre-line" }}><h2>Descrição</h2>{product.description}</section>}
    </main>
  );
}
