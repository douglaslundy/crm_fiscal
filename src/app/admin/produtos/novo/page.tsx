import Link from "next/link";
import { ProductForm } from "@/components/product/product-form";
import { listCategories } from "@/domain/categories";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export default async function NovoProdutoPage() {
  const { store, readOnly } = await adminPage();
  const categories = (await listCategories(store.id)).map(({ id, name }) => ({ id, name }));
  return (
    <main>
      <p><Link href="/admin/produtos">← Produtos</Link></p>
      <h1>Novo produto</h1>
      {readOnly && <p role="status">Loja suspensa: não é possível criar produtos.</p>}
      <ProductForm categories={categories} readOnly={readOnly} />
    </main>
  );
}
