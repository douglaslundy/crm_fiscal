import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/domain/account";
import { isStoreOpen } from "@/domain/catalog";
import { formatBRL } from "@/domain/money";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../../../catalog-view";
import { STATUS_LABEL } from "../../status";

export const dynamic = "force-dynamic";

type Addr = { cep: string; street: string; number: string; complement?: string | null; district: string; city: string; state: string };

/** Detalhe do pedido do cliente logado. Pedido de outro cliente/loja = 404. */
export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, `/conta/pedidos/${encodeURIComponent(id)}`)).user.id;
  const order = await getOrder(store.id, customerId, id);
  if (!order) notFound();
  const a = order.addressSnapshot as Addr;
  return (
    <main style={{ padding: "16px 0", display: "grid", gap: 12 }}>
      <h1>Pedido {order.id}</h1>
      <p>Status: <strong>{STATUS_LABEL[order.status]}</strong></p>
      {order.status === "PENDING_PAYMENT" && <Link href={`/pedido/${order.id}`}>Pagar agora</Link>}
      {order.trackingCode && <p>Código de rastreio: <strong>{order.trackingCode}</strong></p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {order.items.map((i) => (
          <li key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderBottom: "1px solid #eee" }}>
            <span>{i.quantity}× {i.productName} ({i.color} / {i.size})</span><span>{formatBRL(i.unitPriceCents * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <p>Entrega: {a.street}, {a.number}{a.complement ? ` - ${a.complement}` : ""}, {a.district}, {a.city}/{a.state}, CEP {a.cep}</p>
      <p>Subtotal: {formatBRL(order.subtotalCents)}</p>
      {order.discountCents > 0 && <p>Desconto ({order.couponCode}): −{formatBRL(order.discountCents)}</p>}
      <p>Frete ({order.shippingService}): {formatBRL(order.shippingCents)}</p>
      <p style={{ fontSize: 18 }}>Total: <strong>{formatBRL(order.totalCents)}</strong></p>
      <Link href="/conta">Voltar aos pedidos</Link>
    </main>
  );
}
