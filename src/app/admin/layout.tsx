import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Painel da loja" };

// Navegacao apenas; a protecao (404 fora de loja + membro da loja) esta em cada page via adminPage().
// Itens sem pagina ainda aparecem como "em breve" (sem link).
export default function AdminLayout({ children }: { children: ReactNode }) {
  const soon = (label: string) => <span style={{ color: "#888" }} title="Em breve">{label} (em breve)</span>;
  return (
    <div>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 8, borderBottom: "1px solid #ccc" }}>
        <strong>Painel da loja</strong>
        {soon("Painel")}
        <Link href="/admin/categorias">Categorias</Link>
        <Link href="/admin/produtos">Produtos</Link>
        {soon("Pedidos")}
        {soon("Clientes")}
        <Link href="/admin/assinatura">Assinatura</Link>
        {soon("Configurações")}
      </nav>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}
