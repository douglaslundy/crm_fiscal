import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderDetail } from "@/domain/adminOrders";
import { formatBRL } from "@/domain/money";
import { MasterForm } from "@/components/master-form";
import { adminPage } from "@/lib/admin-api";
import { STATUS_LABEL } from "../labels";

export const dynamic = "force-dynamic";

type Addr = { cep: string; street: string; number: string; complement?: string | null; district: string; city: string; state: string };

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { store, readOnly } = await adminPage();
  const o = await getOrderDetail(store.id, (await params).id);
  if (!o) notFound();
  const a = o.addressSnapshot as Addr;
  const url = `/api/admin/orders/${o.id}`;

  return (
    <main>
      <p><Link href="/admin/pedidos">Voltar aos pedidos</Link></p>
      <h1>Pedido {o.id}</h1>
      {readOnly && <p role="status">Loja suspensa: os pedidos ficam somente para leitura.</p>}
      <p>
        {STATUS_LABEL[o.status]} em {o.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.
        Pagamento: {o.paymentMethod ?? "não iniciado"} ({STATUS_LABEL[o.status]}).
      </p>
      <h2>Cliente</h2>
      <p><Link href={`/admin/clientes/${o.customer.id}`}>{o.customer.name}</Link>, {o.customer.email}, {o.customer.phone}</p>
      <h2>Entrega ({o.shippingService})</h2>
      <p>{a.street}, {a.number}{a.complement ? `, ${a.complement}` : ""} - {a.district}, {a.city}/{a.state}, CEP {a.cep}</p>
      <h2>Itens</h2>
      <table>
        <thead><tr><th>Produto</th><th>SKU</th><th>Variação</th><th>Qtd</th><th>Unitário</th><th>Subtotal</th></tr></thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}>
              <td>{i.productName}</td><td>{i.sku}</td><td>{i.color} / {i.size}</td><td>{i.quantity}</td>
              <td>{formatBRL(i.unitPriceCents)}</td><td>{formatBRL(i.unitPriceCents * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Produtos: {formatBRL(o.subtotalCents)}. Frete: {formatBRL(o.shippingCents)}. <strong>Total: {formatBRL(o.totalCents)}</strong></p>
      <h2>Andamento</h2>
      {o.trackingCode && <p>Código de rastreio: {o.trackingCode}</p>}
      {!readOnly && o.status === "PAID" && (
        <MasterForm url={url} method="PATCH" submit="Marcar como enviado" extra={{ status: "SHIPPED" }} fields={[{ name: "trackingCode", label: "Código de rastreio (opcional)" }]} />
      )}
      {!readOnly && o.status === "SHIPPED" && (
        <MasterForm url={url} method="PATCH" submit="Marcar como entregue" extra={{ status: "DELIVERED" }} />
      )}
      {!readOnly && (o.status === "SHIPPED" || o.status === "DELIVERED") && (
        <MasterForm url={url} method="PATCH" submit="Salvar rastreio" fields={[{ name: "trackingCode", label: "Código de rastreio", defaultValue: o.trackingCode }]} />
      )}
      {!readOnly && o.status === "PENDING_PAYMENT" && (
        <MasterForm url={url} method="PATCH" submit="Cancelar pedido" extra={{ status: "CANCELED" }} confirm="Cancelar este pedido? O estoque será devolvido." />
      )}
      {o.status === "PAID" && <p><small>Para cancelar um pedido pago, faça o reembolso pelo painel do Mercado Pago.</small></p>}
    </main>
  );
}
