import { MasterForm, type Field } from "@/components/master-form";
import { listCategories } from "@/domain/categories";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof listCategories>>[number];
type Node = Row & { depth: number };

/** Ordem de arvore (pai antes das filhas) com o nivel de cada linha; orfas nao existem (FK composta). */
function flatten(rows: Row[], parentId: string | null = null, depth = 0): Node[] {
  return rows.filter((r) => r.parentId === parentId).flatMap((r) => [{ ...r, depth }, ...flatten(rows, r.id, depth + 1)]);
}

export default async function CategoriasPage() {
  const { store, readOnly } = await adminPage();
  const rows = await listCategories(store.id);
  const tree = flatten(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentField = (selfId?: string, value?: string | null): Field => {
    // exclui a propria categoria e as descendentes (o servidor tambem recusa ciclo)
    let banned = new Set<string>();
    if (selfId) { banned = new Set([selfId]); for (let grew = true; grew;) { grew = false; for (const r of rows) if (r.parentId && banned.has(r.parentId) && !banned.has(r.id)) { banned.add(r.id); grew = true; } } }
    return {
      name: "parentId", label: "Categoria pai", type: "select", defaultValue: value ?? "",
      options: [{ value: "", label: "(nenhuma, nível principal)" }, ...tree.filter((n) => !banned.has(n.id)).map((n) => ({ value: n.id, label: `${"- ".repeat(n.depth)}${n.name}` }))],
    };
  };
  const fields = (c?: Row): Field[] => [
    { name: "name", label: "Nome", defaultValue: c?.name, required: true },
    { name: "slug", label: c ? "Endereço (slug)" : "Endereço (slug, vazio = automático)", defaultValue: c?.slug, required: Boolean(c) },
    parentField(c?.id, c?.parentId),
  ];

  return (
    <main>
      <h1>Categorias</h1>
      {readOnly && <p role="status">Loja suspensa: as categorias ficam somente para leitura.</p>}
      {tree.length === 0 && <p>Nenhuma categoria ainda.</p>}
      {tree.map((c) => (
        <section key={c.id} style={{ border: "1px solid #ccc", padding: 12, margin: "8px 0", marginLeft: c.depth * 24 }}>
          <h2>{c.name} <small>/{c.slug}</small></h2>
          <p>
            {c.parentId ? `Dentro de: ${byId.get(c.parentId)?.name}. ` : "Nível principal. "}
            {c.productCount} {c.productCount === 1 ? "produto" : "produtos"}, {c.childCount} {c.childCount === 1 ? "subcategoria" : "subcategorias"}.
          </p>
          {!readOnly && (
            <>
              <details>
                <summary>Editar</summary>
                <MasterForm url={`/api/admin/categories/${c.id}`} method="PATCH" submit="Salvar" fields={fields(c)} />
              </details>
              <MasterForm url={`/api/admin/categories/${c.id}`} method="DELETE" submit="Excluir" confirm={`Excluir a categoria "${c.name}"?`} />
            </>
          )}
        </section>
      ))}
      {!readOnly && (
        <>
          <h2>Nova categoria</h2>
          <MasterForm url="/api/admin/categories" submit="Criar categoria" fields={fields()} />
        </>
      )}
    </main>
  );
}
