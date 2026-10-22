import { cache } from "react";
import { notFound } from "next/navigation";
import { getProductBySlug as findProduct, isStoreOpen, jsonLdScript, metaDescription, productJsonLd } from "@/domain/catalog";
import { getProductReviews, reviewEligibility } from "@/domain/reviews";
import { getSettings } from "@/domain/storeSettings";
import { isInWishlist } from "@/domain/wishlist";
import { getSession } from "@/auth";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../../catalog-view";
import { ProductOptions } from "./product-options";
import { ReviewForm } from "./review-form";
import { WishlistButton } from "./wishlist-button";

export const dynamic = "force-dynamic";

const getProductBySlug = cache(findProduct); // metadata e pagina na mesma requisicao: uma consulta so
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const store = await getCurrentStore();
  const product = isStoreOpen(store) ? await getProductBySlug(store.id, (await params).slug) : null;
  if (!product) return {}; // fica o titulo do layout (nome da loja)
  const image = product.images[0]?.url;
  return {
    title: `${product.name} | ${store.name}`,
    description: metaDescription(product.description, `${product.name} na ${store.name}`),
    ...(image ? { openGraph: { images: [image] } } : {}),
  };
}

export default async function ProductPage({ params }: Props) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const { slug } = await params;
  const product = await getProductBySlug(store.id, slug);
  if (!product) notFound(); // inexistente, inativo ou de outra loja: mesma resposta
  const [{ pixDiscountPercent }, reviews, session] = await Promise.all([getSettings(store.id), getProductReviews(store.id, product.id), getSession()]);
  const customerId = session?.user.kind === "customer" && session.user.storeId === store.id ? session.user.id : null;
  const favorite = customerId ? await isInWishlist(store.id, customerId, product.id) : null;
  const eligibility = customerId ? await reviewEligibility(store.id, customerId, product.id) : null;
  return (
    <main style={{ padding: "16px 0" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, reviews)) }} />
      <ProductOptions name={product.name} variants={product.variants} images={product.images} pixPercent={pixDiscountPercent} />
      <p style={{ marginTop: 12 }}><WishlistButton productId={product.id} slug={product.slug} initial={favorite} /></p>
      {product.description && <section style={{ marginTop: 24, whiteSpace: "pre-line" }}><h2>Descrição</h2>{product.description}</section>}
      <section style={{ marginTop: 24 }}>
        <h2>Avaliações</h2>
        {reviews.count === 0 ? <p>Este produto ainda não tem avaliações.</p> : (
          <>
            <p><strong>{reviews.average?.toFixed(1).replace(".", ",")} de 5</strong> ({reviews.count} {reviews.count === 1 ? "avaliação" : "avaliações"})</p>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {reviews.items.map((r) => (
                <li key={r.id} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
                  <span aria-label={`${r.rating} de 5 estrelas`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span> <small>{r.author} · {r.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small>
                  {r.comment && <p style={{ whiteSpace: "pre-line", margin: "4px 0 0" }}>{r.comment}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
        {eligibility === "CAN_REVIEW" && <ReviewForm productId={product.id} />}
        {eligibility === "ALREADY_REVIEWED" && <p>Obrigado! Você já avaliou este produto.</p>}
      </section>
    </main>
  );
}
