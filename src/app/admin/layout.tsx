import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Painel da loja" };

// Navegacao apenas; a protecao (404 fora de loja + membro da loja) esta em cada page via adminPage().
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 8, borderBottom: "1px solid #ccc" }}>
        <strong>Painel da loja</strong>
        <Link href="/admin">Painel</Link>
        <Link href="/admin/categorias">Categorias</Link>
        <Link href="/admin/produtos">Produtos</Link>
        <Link href="/admin/colecoes">Coleções</Link>
        <Link href="/admin/pedidos">Pedidos</Link>
        <Link href="/admin/cupons">Cupons</Link>
        <Link href="/admin/clientes">Clientes</Link>
        <Link href="/admin/inscritos">Inscritos</Link>
        <Link href="/admin/assinatura">Assinatura</Link>
        <Link href="/admin/configuracoes">Configurações</Link>
      </nav>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}
