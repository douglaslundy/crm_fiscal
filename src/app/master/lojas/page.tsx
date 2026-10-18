import Link from "next/link";
import { StoreStatus } from "@prisma/client";
import { listStores } from "@/domain/masterStores";
import { prisma } from "@/lib/db";
import { masterPage } from "@/lib/master-api";
import { STATUS_LABEL, fmtDate } from "./labels";

export const dynamic = "force-dynamic";

type SP = Promise<{ status?: string; planId?: string; q?: string; page?: string }>;

export default async function LojasPage({ searchParams }: { searchParams: SP }) {
  await masterPage();
  const sp = await searchParams;
  const status = StoreStatus[sp.status as keyof typeof StoreStatus];
  const [plans, list] = await Promise.all([
    prisma.plan.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listStores({ status, planId: sp.planId || undefined, q: sp.q, page: Number(sp.page) || 1 }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (page: number) => `/master/lojas?${new URLSearchParams({ ...(sp.status && { status: sp.status }), ...(sp.planId && { planId: sp.planId }), ...(sp.q && { q: sp.q }), page: String(page) })}`;
  return (
    <>
      <h1>Lojas ({list.total})</h1>
      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        <input name="q" defaultValue={sp.q} placeholder="Nome, endereço ou e-mail do dono" />
        <select name="status" defaultValue={sp.status ?? ""}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="planId" defaultValue={sp.planId ?? ""}>
          <option value="">Todos os planos</option>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit">Filtrar</button>
      </form>
      <table>
        <thead><tr><th>Loja</th><th>Dono</th><th>Plano</th><th>Status</th><th>Fim do teste</th><th>Criada em</th></tr></thead>
        <tbody>
          {list.stores.map((s) => (
            <tr key={s.id}>
              <td><Link href={`/master/lojas/${s.id}`}>{s.name}</Link> ({s.slug})</td>
              <td>{s.ownerEmail ?? "-"}</td><td>{s.planName}</td><td>{STATUS_LABEL[s.status]}</td>
              <td>{fmtDate(s.trialEndsAt)}</td><td>{fmtDate(s.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.stores.length === 0 && <p>Nenhuma loja encontrada.</p>}
      <p>
        {list.page > 1 && <Link href={link(list.page - 1)}>Anterior</Link>} Página {list.page} de {pages}{" "}
        {list.page < pages && <Link href={link(list.page + 1)}>Próxima</Link>}
      </p>
    </>
  );
}
