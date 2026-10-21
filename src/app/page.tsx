import Link from "next/link";
import { headers } from "next/headers";
import { formatBRL } from "@/domain/money";
import { prisma } from "@/lib/db";
import { STORE_HOST_HEADER } from "@/lib/host";

export const dynamic = "force-dynamic"; // planos vem do banco

// "/" fisica e da plataforma; em host de loja o proxy reescreve para /vitrine antes de chegar aqui.
export default async function Home() {
  const plans = (await headers()).get(STORE_HOST_HEADER) ? [] : await prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: "asc" } });
  return (
    <>
      <header className="site-header">
        <div className="container bar">
          <Link href="/" className="brand">Plataforma de Lojas</Link>
          <div className="header-links" style={{ marginLeft: "auto" }}>
            <Link href="/entrar">Entrar</Link>
            <Link href="/comecar" className="btn">Criar minha loja</Link>
          </div>
        </div>
      </header>
      <section className="hero">
        <h1>Sua loja de roupas online, pronta em minutos</h1>
        <p>Vitrine, carrinho, Pix, cartão e boleto, frete calculado e painel de gestão. 14 dias grátis, sem cartão.</p>
        <Link href="/comecar" className="btn">Começar grátis</Link>
      </section>
      {plans.length > 0 && (
        <section className="container">
          <h2>Planos</h2>
          <div className="plans">
            {plans.map((p) => (
              <div key={p.id} className="card">
                <h3 style={{ marginTop: 0 }}>{p.name}</h3>
                <p className="price">{formatBRL(p.priceCents)}<span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}> /mês</span></p>
                <ul>
                  <li>{p.productLimit == null ? "Produtos ilimitados" : `Até ${p.productLimit} produtos`}</li>
                  <li>{p.staffLimit} {p.staffLimit === 1 ? "colaborador" : "colaboradores"}</li>
                  {p.customDomain && <li>Domínio próprio</li>}
                  {p.advancedMetrics && <li>Métricas avançadas</li>}
                  {p.csvExport && <li>Exportação CSV</li>}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="site-footer"><div className="container">© Plataforma de Lojas · <Link href="/termos">Termos de uso</Link> · <Link href="/privacidade">Privacidade</Link></div></footer>
    </>
  );
}
