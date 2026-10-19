import Link from "next/link";
import { listCustomers, parseListQuery } from "@/domain/adminOrders";
import { formatBRL } from "@/domain/money";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function ClientesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store } = await adminPage();
  const parsed = parseListQuery(await searchParams, ["page", "q"]);
  const query = parsed ?? {};
  const { items, total, page, pageSize } = await listCustomers(store.id, query);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `/admin/clientes?${new URLSearchParams(Object.entries({ ...query, page: p }).map(([k, v]) => [k, String(v)]))}`;

  return (
    <main>
      <h1>Clientes</h1>
      {!parsed && <p role="alert">Filtros inválidos foram ignorados.</p>}
      <form method="get" style={{ display: "flex", gap: 8, alignItems: "end", margin: "8px 0" }}>
        <label>Buscar (nome ou e-mail) <input name="q" defaultValue={query.q ?? ""} maxLength={100} /></label>
        <button type="submit">Filtrar</button>
      </form>
      <p>{total} {total === 1 ? "cliente" : "clientes"}</p>
      {items.length === 0 ? <p>Nenhum cliente encontrado.</p> : (
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Pedidos</th><th>Total gasto</th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}><td>{c.name}</td><td>{c.email}</td><td>{c.orderCount}</td><td>{formatBRL(c.totalSpentCents)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ display: "flex", gap: 12 }}>
        {page > 1 && <Link href={href(page - 1)}>Anterior</Link>}
        <span>Página {page} de {pages}</span>
        {page < pages && <Link href={href(page + 1)}>Próxima</Link>}
      </p>
    </main>
  );
}
