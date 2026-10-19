import Link from "next/link";
import { notFound } from "next/navigation";
import { isStoreOpen } from "@/domain/catalog";
import { formatBRL } from "@/domain/money";
import { amountFor } from "@/domain/payments";
import { getSettings } from "@/domain/storeSettings";
import { dbForStore } from "@/lib/db-store";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../../catalog-view";
import { PaymentPanel } from "./payment-panel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Pedido do cliente logado: resumo e pagamento (cartao via Brick ou Pix). Pedido de outro cliente/loja = 404. */
export default async function OrderPage({ params }: Props) {
  const { id } = await params;
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, `/pedido/${encodeURIComponent(id)}`)).user.id;
  const db = dbForStore(store.id);
  const order = await db.order.findFirst({
    where: { id, customerId },
    select: { id: true, status: true, subtotalCents: true, shippingCents: true, totalCents: true, shippingService: true, couponCode: true, discountCents: true, pixQrCode: true, pixQrBase64: true, pixExpiresAt: true },
  });
  if (!order) notFound();
  const items = await db.orderItem.findMany({ where: { orderId: order.id }, select: { id: true, productName: true, color: true, size: true, quantity: true, unitPriceCents: true } });
  const pixCents = amountFor("pix", order.totalCents, (await getSettings(store.id)).pixDiscountPercent);
  return (
    <main style={{ padding: "16px 0", display: "grid", gap: 16 }}>
      <h1>Pedido {order.id}</h1>
      <section>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {items.map((i) => (
            <li key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", borderBottom: "1px solid #eee" }}>
              <span>{i.quantity}× {i.productName} ({i.color} / {i.size})</span><span>{formatBRL(i.unitPriceCents * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <p>Subtotal: {formatBRL(order.subtotalCents)}</p>
        {order.discountCents > 0 && <p>Desconto ({order.couponCode}): −{formatBRL(order.discountCents)}</p>}
        <p>Frete ({order.shippingService}): {formatBRL(order.shippingCents)}</p>
        <p style={{ fontSize: 18 }}>Total: <strong>{formatBRL(order.totalCents)}</strong></p>
      </section>
      <PaymentPanel
        orderId={order.id}
        initialStatus={order.status}
        totalCents={order.totalCents}
        pixCents={pixCents}
        initialPix={order.pixQrCode && order.pixExpiresAt ? { qrCode: order.pixQrCode, qrCodeBase64: order.pixQrBase64, expiresAt: order.pixExpiresAt.toISOString() } : null}
      />
      <Link href="/">Continuar comprando</Link>
    </main>
  );
}
