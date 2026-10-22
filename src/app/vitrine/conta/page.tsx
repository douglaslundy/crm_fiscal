import Link from "next/link";
import { isStoreOpen } from "@/domain/catalog";
import { listOrders } from "@/domain/account";
import { formatBRL } from "@/domain/money";
import { requireCustomer } from "@/lib/guards";
import { getCurrentStore } from "@/lib/tenant";
import { Unavailable } from "../catalog-view";
import { STATUS_LABEL } from "./status";
import { dbForStore } from "@/lib/db-store";
import { sendVerifyEmail } from "@/domain/notifications";
import { createRateLimiter } from "@/lib/rate-limit";
import { storeOrigin } from "@/lib/urls";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const resendLimiter = createRateLimiter({ limit: 3, windowMs: 60 * 60_000 });

/** Reenvia a confirmacao de e-mail do cliente logado (3 por hora). */
async function resendVerification() {
  "use server";
  const store = await getCurrentStore();
  const customerId = (await requireCustomer(store.id, "/conta")).user.id;
  if (!resendLimiter.check(customerId).ok) return;
  const c = await dbForStore(store.id).customer.findUnique({ where: { id: customerId }, select: { name: true, email: true, emailVerifiedAt: true } });
  if (c && !c.emailVerifiedAt) await sendVerifyEmail("CUSTOMER", customerId, c.email, c.name, storeOrigin(store.slug));
  revalidatePath("/conta");
}

/** Conta do comprador: so os pedidos do cliente logado nesta loja. */
export default async function AccountPage() {
  const store = await getCurrentStore();
  if (!isStoreOpen(store)) return <Unavailable />;
  const customerId = (await requireCustomer(store.id, "/conta")).user.id;
  const orders = await listOrders(store.id, customerId);
  const me = await dbForStore(store.id).customer.findUnique({ where: { id: customerId }, select: { emailVerifiedAt: true } });
  return (
    <main style={{ padding: "16px 0", display: "grid", gap: 12 }}>
      <h1>Minha conta</h1>
      {me && !me.emailVerifiedAt && (
        <form action={resendVerification} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Seu e-mail ainda não foi confirmado.</span>
          <button type="submit">Reenviar confirmação</button>
        </form>
      )}
      <nav className="pills" aria-label="Conta">
        <Link href="/conta/enderecos">Meus endereços</Link>
        <Link href="/conta/favoritos">Meus favoritos</Link>
      </nav>
      <h2>Meus pedidos</h2>
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
