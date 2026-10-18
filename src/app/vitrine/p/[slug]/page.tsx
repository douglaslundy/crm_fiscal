import { notFound } from "next/navigation";
import { getProductBySlug, isStoreOpen, jsonLdScript, productJsonLd } from "@/domain/catalog";
import { getSettings } from "@/domain/storeSettings";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../../catalog-view";
import { ProductOptions } from "./product-options";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
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
