import { CollectionProducts } from "@/components/collection-products";
import { MasterForm, type Field } from "@/components/master-form";
import { MAX_COLLECTION_PRODUCTS, collectionProductIds, listCollections } from "@/domain/collections";
import { adminPage } from "@/lib/admin-api";
import { dbForStore } from "@/lib/db-store";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listCollections>>[number];

export default async function ColecoesPage() {
  const { store, readOnly } = await adminPage();
  const [rows, products] = await Promise.all([
    listCollections(store.id),
    dbForStore(store.id).product.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: MAX_COLLECTION_PRODUCTS }),
  ]);
  const selected = new Map(await Promise.all(rows.map(async (c) => [c.id, await collectionProductIds(store.id, c.id)] as const)));
  const fields = (c?: Row): Field[] => [
    { name: "name", label: "Nome", defaultValue: c?.name, required: true },
    { name: "slug", label: c ? "Endereço (slug)" : "Endereço (slug, vazio = automático)", defaultValue: c?.slug, required: Boolean(c) },
    { name: "active", label: "Ativa (aparece no menu da loja)", type: "checkbox", defaultValue: c?.active ?? true },
  ];
  return (
    <main>
      <h1>Coleções</h1>
      <p>Agrupe produtos por tema (ex.: Verão), independente das categorias. Só aparecem no menu coleções ativas com produtos.</p>
      {readOnly && <p role="status">Loja suspensa: as coleções ficam somente para leitura.</p>}
      {rows.length === 0 && <p>Nenhuma coleção ainda.</p>}
      {rows.map((c) => (
        <section key={c.id} style={{ border: "1px solid #ccc", padding: 12, margin: "8px 0" }}>
          <h2>{c.name} <small>/colecao/{c.slug} · {c.productCount} produtos · {c.active ? "ativa" : "inativa"}</small></h2>
          {!readOnly && (
            <details>
              <summary>Editar</summary>
              <MasterForm url={`/api/admin/collections/${c.id}`} method="PATCH" submit="Salvar" fields={fields(c)} />
              <h3>Produtos</h3>
              <CollectionProducts collectionId={c.id} products={products} selected={selected.get(c.id) ?? []} />
              <MasterForm url={`/api/admin/collections/${c.id}`} method="DELETE" submit="Excluir coleção" confirm={`Excluir a coleção ${c.name}? Os produtos não são apagados.`} />
            </details>
          )}
        </section>
      ))}
      {!readOnly && (
        <section>
          <h2>Nova coleção</h2>
          <MasterForm url="/api/admin/collections" submit="Criar coleção" fields={fields()} />
        </section>
      )}
    </main>
  );
}
