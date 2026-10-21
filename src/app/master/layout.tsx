import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Painel master" };

// Navegacao apenas; a protecao (404 em host de loja + requireMaster) esta em cada page via masterPage().
export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <div className="panel">
      <nav className="panel-nav" aria-label="Painel master">
        <strong>Painel master</strong>
        <Link href="/master">Métricas</Link>
        <Link href="/master/lojas">Lojas</Link>
        <Link href="/master/lojas/nova">Nova loja</Link>
        <Link href="/master/planos">Planos</Link>
      </nav>
      <main className="panel-body">{children}</main>
    </div>
  );
}
