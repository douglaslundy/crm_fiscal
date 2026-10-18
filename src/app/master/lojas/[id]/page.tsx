import { notFound } from "next/navigation";
import { formatBRL } from "@/domain/money";
import { MasterForm } from "@/components/master-form";
import { prisma } from "@/lib/db";
import { masterPage } from "@/lib/master-api";
import { STATUS_LABEL, SUB_LABEL, fmtDate } from "../labels";

export const dynamic = "force-dynamic";

export default async function LojaDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  await masterPage();
  const { id } = await params;
  const [store, plans] = await Promise.all([
    prisma.store.findUnique({
      where: { id },
      include: { plan: true, subscription: true, members: { include: { account: { select: { name: true, email: true } } } } },
    }),
    prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } }),
  ]);
  if (!store) notFound();
  const api = `/api/master/stores/${store.id}`;
  const suspended = store.status === "SUSPENDED";
  return (
    <>
      <h1>{store.name}</h1>
      <p>Endereço: {store.slug}</p>
      <p>Status: {STATUS_LABEL[store.status]} | Plano: {store.plan.name} ({formatBRL(store.plan.priceCents)}/mês)</p>
      <p>Criada em {fmtDate(store.createdAt)} | Fim do teste: {fmtDate(store.trialEndsAt)} | Carência até: {fmtDate(store.graceEndsAt)}</p>
      <h2>Assinatura</h2>
      <p>
        {store.subscription ? SUB_LABEL[store.subscription.status] : "Sem assinatura"}
        {store.subscription?.mpPreapprovalId ? " (Mercado Pago)" : " (sem cobrança automática)"}
        {" | Próximo pagamento: "}{fmtDate(store.subscription?.currentPeriodEnd)}
      </p>
      <h2>Membros</h2>
      <ul>{store.members.map((m) => <li key={m.accountId}>{m.account.name} ({m.account.email}) - {m.role === "OWNER" ? "dono" : "colaborador"}</li>)}</ul>

      <h2>Ações</h2>
      {suspended || store.status === "CANCELED" ? (
        <MasterForm url={`${api}/reactivate`} submit="Reativar loja" confirm="Reativar esta loja manualmente? Uma assinatura real no Mercado Pago mantém o próprio estado." />
      ) : (
        <MasterForm url={`${api}/suspend`} submit="Suspender loja" confirm="Suspender esta loja? A vitrine para de vender até ser reativada." />
      )}
      <MasterForm url={api} method="PATCH" submit="Renomear" fields={[{ name: "name", label: "Nome", defaultValue: store.name, required: true }]} />
      <MasterForm
        url={`${api}/plan`} submit="Trocar plano"
        fields={[{ name: "planId", label: "Plano", type: "select", defaultValue: store.planId, options: plans.map((p) => ({ value: p.id, label: `${p.name} - ${formatBRL(p.priceCents)}/mês` })) }]}
      />
      <p><small>Trocar o plano altera limites e recursos, mas não o valor cobrado pelo Mercado Pago.</small></p>
    </>
  );
}
