import { computePlatformMetrics } from "@/domain/platformMetrics";
import { formatBRL } from "@/domain/money";
import { prisma } from "@/lib/db";
import { masterPage } from "@/lib/master-api";

export const dynamic = "force-dynamic";

export default async function MasterDashboard() {
  await masterPage();
  const rows = await prisma.store.findMany({ select: { id: true, status: true, createdAt: true, plan: { select: { name: true, priceCents: true } } } });
  const m = computePlatformMetrics(rows, new Date());
  const cards: [string, string | number][] = [
    ["Lojas ativas", m.activeStores], ["Em teste", m.trialingStores], ["Suspensas", m.suspendedStores], ["MRR", formatBRL(m.mrrCents)],
  ];
  return (
    <>
      <h1>Métricas da plataforma</h1>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {cards.map(([label, value]) => (
          <div key={label} style={{ border: "1px solid #ccc", padding: 12, minWidth: 140 }}>
            <div>{label}</div>
            <strong style={{ fontSize: 24 }}>{value}</strong>
          </div>
        ))}
      </div>
      <h2>Lojas por plano</h2>
      {m.storesByPlan.length === 0 ? <p>Nenhuma loja ainda.</p> : (
        <ul>{m.storesByPlan.map((p) => <li key={p.planName}>{p.planName}: {p.count}</li>)}</ul>
      )}
      <h2>Cadastros nos últimos 30 dias</h2>
      <table>
        <thead><tr><th>Dia (UTC)</th><th>Cadastros</th></tr></thead>
        <tbody>{m.signupsByDay.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </>
  );
}
