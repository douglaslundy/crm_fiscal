import Link from "next/link";
import { listOrders, parseListQuery } from "@/domain/adminOrders";
import { formatBRL } from "@/domain/money";
import { adminPage } from "@/lib/admin-api";
import { STATUS_LABEL } from "./labels";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function PedidosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store } = await adminPage();
  const parsed = parseListQuery(await searchParams);
  const query = parsed ?? {}; // filtro invalido: ignora e mostra tudo
  const { items, total, page, pageSize } = await listOrders(store.id, query);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `/admin/pedidos?${new URLSearchParams(Object.entries({ ...query, page: p }).map(([k, v]) => [k, String(v)]))}`;

  return (
    <main>
      <h1>Pedidos</h1>
      {!parsed && <p role="alert">Filtros inválidos foram ignorados.</p>}
      <form method="get" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end", margin: "8px 0" }}>
        <label>Buscar (nº do pedido, cliente ou e-mail) <input name="q" defaultValue={query.q ?? ""} maxLength={100} /></label>
        <label>
          Situação{" "}
          <select name="status" defaultValue={query.status ?? ""}>
            <option value="">Todas</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>De <input type="date" name="from" defaultValue={query.from ?? ""} /></label>
        <label>Até <input type="date" name="to" defaultValue={query.to ?? ""} /></label>
        <button type="submit">Filtrar</button>
      </form>
      <p>{total} {total === 1 ? "pedido" : "pedidos"}</p>
      {items.length === 0 ? <p>Nenhum pedido encontrado.</p> : (
        <table>
          <thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Total</th><th>Situação</th></tr></thead>
          <tbody>
            {items.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/admin/pedidos/${o.id}`}>{o.id}</Link></td>
                <td>{o.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{o.customer.name} <small>{o.customer.email}</small></td>
                <td>{formatBRL(o.totalCents)}</td>
                <td>{STATUS_LABEL[o.status]}</td>
              </tr>
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
