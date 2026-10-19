import Link from "next/link";
import { isStoreOpen } from "@/domain/catalog";
import { listOrders } from "@/domain/account";
import { formatBRL } from "@/domain/money";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../catalog-view";
import { STATUS_LABEL } from "./status";

export const dynamic = "force-dynamic";

/** Conta do comprador: so os pedidos do cliente logado nesta loja. */
export default async function AccountPage() {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, "/conta")).user.id;
  const orders = await listOrders(store.id, customerId);
  return (
    <main style={{ padding: "16px 0", display: "grid", gap: 12 }}>
      <h1>Meus pedidos</h1>
      <Link href="/conta/enderecos">Meus endereços</Link>
      {orders.length === 0 ? <p>Você ainda não fez pedidos.</p> : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {orders.map((o) => (
            <li key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px solid #eee" }}>
              <Link href={`/conta/pedidos/${o.id}`}>{o.createdAt.toLocaleDateString("pt-BR")} · {o.id}</Link>
              <span>{STATUS_LABEL[o.status]} · {formatBRL(o.totalCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
