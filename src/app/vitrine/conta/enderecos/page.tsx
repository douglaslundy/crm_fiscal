import Link from "next/link";
import { listAddresses } from "@/domain/account";
import { isStoreOpen } from "@/domain/catalog";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../../catalog-view";
import { AddressesView } from "./addresses-view";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, "/conta/enderecos")).user.id;
  return (
    <main style={{ padding: "16px 0", display: "grid", gap: 12 }}>
      <h1>Meus endereços</h1>
      <AddressesView initial={await listAddresses(store.id, customerId)} />
      <Link href="/conta">Voltar</Link>
    </main>
  );
}
