import { isStoreOpen } from "@/domain/catalog";
import { dbForStore } from "@/lib/db-store";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../catalog-view";
import { CheckoutView } from "./checkout-view";

export const dynamic = "force-dynamic";

/** Checkout: so cliente logado desta loja (anonimo vai ao login e volta para ca; o carrinho fica no navegador). */
export default async function CheckoutPage() {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, "/checkout")).user.id;
  const db = dbForStore(store.id);
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
