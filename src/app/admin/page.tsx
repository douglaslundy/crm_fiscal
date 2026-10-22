import Link from "next/link";
import { getFeatures } from "@/domain/entitlements";
import { DAYS_OPTIONS, loadStoreMetrics, parseDays } from "@/domain/metrics";
import { formatBRL } from "@/domain/money";
import { adminPage } from "@/lib/admin-api";
import { prisma } from "@/lib/db";
import { sendVerifyEmail } from "@/domain/notifications";
import { createRateLimiter } from "@/lib/rate-limit";
import { platformOrigin } from "@/lib/urls";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

const resendLimiter = createRateLimiter({ limit: 3, windowMs: 60 * 60_000 });

/** Reenvia a confirmacao de e-mail de quem esta logado no painel (3 por hora). */
async function resendVerification() {
  "use server";
  const { session } = await adminPage();
  if (!resendLimiter.check(session.user.id).ok) return;
  const a = await prisma.account.findUnique({ where: { id: session.user.id }, select: { name: true, email: true, emailVerifiedAt: true } });
  if (a && !a.emailVerifiedAt) await sendVerifyEmail("ACCOUNT", session.user.id, a.email, a.name, platformOrigin());
  revalidatePath("/admin");
}

export default async function PainelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store, session } = await adminPage();
  const me = await prisma.account.findUnique({ where: { id: session.user.id }, select: { emailVerifiedAt: true } });
  const days = parseDays((await searchParams).days);
  const [m, features] = await Promise.all([loadStoreMetrics(store.id, days), getFeatures(store.id)]);
  const max = Math.max(1, ...(m.byDay ?? []).map((d) => d.revenueCents));

  return (
    <main>
      <h1>Painel</h1>
      {me && !me.emailVerifiedAt && (
        <form action={resendVerification} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Seu e-mail ainda não foi confirmado.</span>
          <button type="submit">Reenviar confirmação</button>
        </form>
      )}
      <p style={{ display: "flex", gap: 12 }}>
        {DAYS_OPTIONS.map((d) => (d === days ? <strong key={d}>{d} dias</strong> : <Link key={d} href={`/admin?days=${d}`}>{d} dias</Link>))}
      </p>
      <dl>
        <dt>Receita</dt><dd>{formatBRL(m.revenueCents)}</dd>
        <dt>Pedidos</dt><dd>{m.orderCount}</dd>
        <dt>Ticket médio</dt><dd>{formatBRL(m.avgTicketCents)}</dd>
      </dl>
      {m.byDay && (
        <section>
          <h2>Receita por dia</h2>
          <div role="img" aria-label="Receita por dia" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120 }}>
            {m.byDay.map((d) => (
              <div key={d.date} title={`${d.date}: ${formatBRL(d.revenueCents)}`} style={{ flex: 1, background: "#36c", minHeight: 1, height: `${(d.revenueCents / max) * 100}%` }} />
            ))}
          </div>
        </section>
      )}
      {m.topProducts && (
        <section>
          <h2>Mais vendidos</h2>
          {m.topProducts.length === 0 ? <p>Sem vendas no período.</p> : (
            <ol>{m.topProducts.map((p) => <li key={p.name}>{p.name}: {p.qty}</li>)}</ol>
          )}
        </section>
      )}
      {!m.byDay && <p>Gráfico por dia e produtos mais vendidos estão disponíveis em planos superiores.</p>}
      {features.csvExport && <p><a href={`/api/admin/export?days=${days}`}>Exportar pedidos (CSV)</a></p>}
    </main>
  );
}
