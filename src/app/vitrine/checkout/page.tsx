import Link from "next/link";
import { isStoreOpen } from "@/domain/catalog";
import { formatBRL } from "@/domain/money";
import { dbForStore } from "@/lib/db-store";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../catalog-view";
import { CheckoutView } from "./checkout-view";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ pedido?: string | string[] }> };

/** Checkout: so cliente logado desta loja (anonimo vai ao login e volta para ca; o carrinho fica no navegador). */
export default async function CheckoutPage({ searchParams }: Props) {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, "/checkout")).user.id;
  const db = dbForStore(store.id);
  const { pedido } = await searchParams;
  const order = typeof pedido === "string"
    ? await db.order.findFirst({ where: { id: pedido, customerId }, select: { id: true, totalCents: true } })
    : null;
  if (order) {
    return (
      <main style={{ padding: "16px 0" }}>
        <h1>Pedido criado</h1>
        <p role="status">Pedido criado, aguardando pagamento.</p>
        <p>Número do pedido: <strong>{order.id}</strong></p>
        <p>Total: <strong>{formatBRL(order.totalCents)}</strong></p>
        <Link href="/">Continuar comprando</Link>
      </main>
    );
  }
  const addresses = await db.address.findMany({
    where: { customerId },
    select: { id: true, cep: true, street: true, number: true, complement: true, district: true, city: true, state: true },
    orderBy: { id: "asc" },
  });
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>Finalizar compra</h1>
      <CheckoutView initialAddresses={addresses} />
    </main>
  );
}
