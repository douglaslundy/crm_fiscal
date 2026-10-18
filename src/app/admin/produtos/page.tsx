import Link from "next/link";
import { listCategories } from "@/domain/categories";
import { formatBRL } from "@/domain/money";
import { listProducts, parseProductQuery } from "@/domain/products";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store, readOnly } = await adminPage();
  const sp = await searchParams;
  const parsed = parseProductQuery(sp);
  const query = parsed ?? {}; // filtro invalido: ignora e mostra tudo
  const [{ items, total, page, pageSize }, categories] = await Promise.all([listProducts(store.id, query), listCategories(store.id)]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `/admin/produtos?${new URLSearchParams(Object.entries({ ...query, page: p }).map(([k, v]) => [k, String(v)]))}`;

  return (
    <main>
      <h1>Produtos</h1>
      {readOnly ? <p role="status">Loja suspensa: os produtos ficam somente para leitura.</p> : <p><Link href="/admin/produtos/novo">Novo produto</Link></p>}
      {!parsed && <p role="alert">Filtros inválidos foram ignorados.</p>}
      <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", margin: "8px 0" }}>
        <label>Buscar (nome ou SKU) <input name="q" defaultValue={query.q ?? ""} maxLength={100} /></label>
        <label>
          Categoria{" "}
          <select name="categoryId" defaultValue={query.categoryId ?? ""}>
            <option value="">Todas</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Situação{" "}
          <select name="active" defaultValue={query.active === undefined ? "" : String(query.active)}>
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
        </label>
        <button type="submit">Filtrar</button>
      </form>
      <p>{total} {total === 1 ? "produto" : "produtos"}</p>
      {items.length === 0 ? <p>Nenhum produto encontrado.</p> : (
        <table>
          <thead><tr><th /><th>Nome</th><th>Categoria</th><th>Variações</th><th>A partir de</th><th>Estoque</th><th>Situação</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td>{p.imageUrl && <img src={p.imageUrl} alt="" width={48} height={48} style={{ objectFit: "cover" }} />}</td>
                <td><Link href={`/admin/produtos/${p.id}`}>{p.name}</Link></td>
                <td>{p.categoryName ?? "-"}</td>
                <td>{p.variantCount}</td>
                <td>{p.minPriceCents === null ? "-" : formatBRL(p.minPriceCents)}</td>
                <td>{p.totalStock}</td>
                <td>{p.active ? "Ativo" : "Inativo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <nav aria-label="Páginas" style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {page > 1 && <Link href={href(page - 1)}>Anterior</Link>}
          <span>Página {page} de {pages}</span>
          {page < pages && <Link href={href(page + 1)}>Próxima</Link>}
        </nav>
      )}
    </main>
  );
}
