import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SignupForm } from "@/components/signup-form";
import { formatBRL } from "@/domain/money";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

export const dynamic = "force-dynamic"; // planos vem do banco

export default async function ComecarPage() {
  if ((await headers()).get(STORE_HOST_HEADER)) notFound(); // so no host da plataforma
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } });
  const options = plans.map((p) => ({
    id: p.id,
    label: `${p.name} - ${formatBRL(p.priceCents)}/mês`,
    details: [
      p.productLimit == null ? "produtos ilimitados" : `até ${p.productLimit} produtos`,
      `${p.staffLimit} ${p.staffLimit === 1 ? "colaborador" : "colaboradores"}`,
      p.customDomain && "domínio próprio",
      p.advancedMetrics && "métricas avançadas",
    ].filter(Boolean).join(", "),
  }));
  return (
    <main className="narrow">
      <h1>Crie sua loja</h1>
      <p>14 dias grátis, sem cartão.</p>
      <SignupForm plans={options} />
    </main>
  );
}
