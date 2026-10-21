import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Painel da loja" };

const LINKS = [
  ["/admin", "Painel"], ["/admin/pedidos", "Pedidos"], ["/admin/produtos", "Produtos"], ["/admin/categorias", "Categorias"],
  ["/admin/colecoes", "Coleções"], ["/admin/cupons", "Cupons"], ["/admin/clientes", "Clientes"], ["/admin/avaliacoes", "Avaliações"],
  ["/admin/inscritos", "Inscritos"], ["/admin/assinatura", "Assinatura"], ["/admin/configuracoes", "Configurações"],
] as const;

// Navegacao apenas; a protecao (404 fora de loja + membro da loja) esta em cada page via adminPage().
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="panel">
      <nav className="panel-nav" aria-label="Painel da loja">
        <strong>Painel da loja</strong>
        {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
      </nav>
      <div className="panel-body">{children}</div>
    </div>
  );
}
