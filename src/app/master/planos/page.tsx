import { formatBRL } from "@/domain/money";
import { MasterForm, type Field } from "@/components/master-form";
import { prisma } from "@/lib/db";
import { masterPage } from "@/lib/master-api";

export const dynamic = "force-dynamic";

const fields = (p?: { name: string; priceCents: number; productLimit: number | null; staffLimit: number; customDomain: boolean; advancedMetrics: boolean; csvExport: boolean; transactionFeeBps: number }): Field[] => [
  { name: "name", label: "Nome", defaultValue: p?.name, required: true },
  { name: "priceCents", label: "Preço (centavos/mês)", type: "number", defaultValue: p?.priceCents ?? 0, required: true },
  { name: "productLimit", label: "Limite de produtos (vazio = ilimitado)", type: "number", nullable: true, defaultValue: p?.productLimit },
  { name: "staffLimit", label: "Colaboradores", type: "number", defaultValue: p?.staffLimit ?? 1, required: true },
  { name: "transactionFeeBps", label: "Taxa por transação (bps, 0-10000)", type: "number", defaultValue: p?.transactionFeeBps ?? 0 },
  { name: "customDomain", label: "Domínio próprio", type: "checkbox", defaultValue: p?.customDomain },
  { name: "advancedMetrics", label: "Métricas avançadas", type: "checkbox", defaultValue: p?.advancedMetrics },
  { name: "csvExport", label: "Exportação CSV", type: "checkbox", defaultValue: p?.csvExport },
];

export default async function PlanosPage() {
  await masterPage();
  const plans = await prisma.plan.findMany({ orderBy: { priceCents: "asc" }, include: { _count: { select: { stores: true } } } });
  return (
    <>
      <h1>Planos</h1>
      {plans.map((p) => (
        <section key={p.id} style={{ border: "1px solid #ccc", padding: 12, margin: "12px 0" }}>
          <h2>{p.name} - {formatBRL(p.priceCents)}/mês {p.active ? "" : "(inativo)"}</h2>
          <p>{p._count.stores} {p._count.stores === 1 ? "loja" : "lojas"}</p>
          <details>
            <summary>Editar</summary>
            <MasterForm url={`/api/master/plans/${p.id}`} method="PATCH" submit="Salvar" fields={fields(p)} />
          </details>
          <MasterForm
            url={`/api/master/plans/${p.id}`} method="PATCH" extra={{ active: !p.active }} submit={p.active ? "Desativar" : "Reativar"}
            confirm={p.active ? "Desativar o plano? Ele deixa de aparecer para novos cadastros." : undefined}
          />
          {p._count.stores === 0 && <MasterForm url={`/api/master/plans/${p.id}`} method="DELETE" submit="Excluir" confirm="Excluir o plano definitivamente?" />}
        </section>
      ))}
      <h2>Novo plano</h2>
      <MasterForm url="/api/master/plans" submit="Criar plano" fields={fields()} />
    </>
  );
}
