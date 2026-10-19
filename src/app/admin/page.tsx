import Link from "next/link";
import { getFeatures } from "@/domain/entitlements";
import { DAYS_OPTIONS, loadStoreMetrics, parseDays } from "@/domain/metrics";
import { formatBRL } from "@/domain/money";
import { adminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function PainelPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store } = await adminPage();
  const days = parseDays((await searchParams).days);
  const [m, features] = await Promise.all([loadStoreMetrics(store.id, days), getFeatures(store.id)]);
  const max = Math.max(1, ...(m.byDay ?? []).map((d) => d.revenueCents));

  return (
    <main>
      <h1>Painel</h1>
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
