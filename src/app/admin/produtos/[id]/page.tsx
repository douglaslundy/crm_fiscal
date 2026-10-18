import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteProduct } from "@/components/product/delete-product";
import { ProductForm } from "@/components/product/product-form";
import { VariantEditor } from "@/components/product/variant-editor";
import { listCategories } from "@/domain/categories";
import { ProductError, getProduct } from "@/domain/products";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export default async function EditarProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { store, readOnly } = await adminPage();
  const { id } = await params;
  const product = await getProduct(store.id, id).catch((e) => {
    if (e instanceof ProductError) notFound(); // outra loja ou inexistente
    throw e;
  });
  const categories = (await listCategories(store.id)).map(({ id, name }) => ({ id, name }));
  const variants = product.variants.map(({ id, color, size, sku, priceCents, stock, active }) => ({ id, color, size, sku, priceCents, stock, active }));
  return (
    <main>
      <p><Link href="/admin/produtos">← Produtos</Link></p>
      <h1>{product.name}</h1>
      {readOnly && <p role="status">Loja suspensa: o produto fica somente para leitura.</p>}
      <ProductForm categories={categories} product={product} variantColors={[...new Set(variants.map((v) => v.color))]} readOnly={readOnly} />
      <h2>Variações</h2>
      <VariantEditor productId={product.id} variants={variants} productName={product.name} readOnly={readOnly} />
      {!readOnly && <DeleteProduct id={product.id} name={product.name} />}
    </main>
  );
}
