import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/domain/adminOrders";
import { formatBRL } from "@/domain/money";
import { adminPage } from "@/lib/admin-api";
import { STATUS_LABEL } from "../../pedidos/labels";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { store } = await adminPage();
  const c = await getCustomerDetail(store.id, (await params).id);
  if (!c) notFound();
  return (
    <main>
      <p><Link href="/admin/clientes">Voltar aos clientes</Link></p>
      <h1>{c.name}</h1>
      <p>{c.email}{c.phone ? ` · ${c.phone}` : ""}</p>
      <p>Cliente desde {c.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
      <h2>Endereços</h2>
      {c.addresses.length === 0 ? <p>Nenhum endereço salvo.</p> : (
        <ul>
          {c.addresses.map((a) => (
            <li key={a.id}>{a.street}, {a.number}{a.complement ? `, ${a.complement}` : ""} - {a.district}, {a.city}/{a.state}, CEP {a.cep}</li>
          ))}
        </ul>
      )}
      <h2>Pedidos</h2>
      {c.orders.length === 0 ? <p>Nenhum pedido.</p> : (
        <table>
          <thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            {c.orders.map((o) => (
              <tr key={o.id}>
                <td><Link href={`/admin/pedidos/${o.id}`}>{o.id}</Link></td>
                <td>{o.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{STATUS_LABEL[o.status]}</td>
                <td>{formatBRL(o.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
