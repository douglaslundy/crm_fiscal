import { isStoreOpen } from "@/domain/catalog";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../catalog-view";
import { CartView } from "./cart-view";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  if (!isStoreOpen(await getCurrentStore())) return <Unavailable />;
  return (
    <main style={{ padding: "16px 0" }}>
      <h1>Carrinho</h1>
      <CartView />
    </main>
  );
}
