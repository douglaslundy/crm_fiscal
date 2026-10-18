import { formatBRL } from "@/domain/money";
import { MasterForm } from "@/components/master-form";
import { prisma } from "@/lib/db";
import { masterPage } from "@/lib/master-api";

export const dynamic = "force-dynamic";

export default async function NovaLojaPage() {
  await masterPage();
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } });
  return (
    <>
      <h1>Nova loja</h1>
      <p>Se o e-mail já tiver conta, a loja é vinculada a ela (a senha é ignorada). Conta nova exige senha.</p>
      <MasterForm
        url="/api/master/stores" submit="Criar loja" redirectTo="/master/lojas"
        fields={[
          { name: "ownerName", label: "Nome do dono", required: true },
          { name: "email", label: "E-mail do dono", type: "email", required: true },
          { name: "password", label: "Senha (conta nova)", type: "password" },
          { name: "storeName", label: "Nome da loja", required: true },
          { name: "slug", label: "Endereço (opcional)" },
          { name: "planId", label: "Plano", type: "select", required: true, options: plans.map((p) => ({ value: p.id, label: `${p.name} - ${formatBRL(p.priceCents)}/mês` })) },
          { name: "startMode", label: "Início", type: "select", defaultValue: "trial", options: [{ value: "trial", label: "Teste grátis de 14 dias" }, { value: "active", label: "Ativa direto (cortesia, sem cobrança)" }] },
        ]}
      />
    </>
  );
}
