import Link from "next/link";
import type { ReactNode } from "react";
import { getMenu, isStoreOpen } from "@/domain/catalog";
import { getCurrentStore } from "@/lib/tenant";
import { CartLink } from "./cart-link";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getCurrentStore()).name };
}

// Vitrine publica (sem login). Rotas publicas da loja chegam aqui pela reescrita do middleware.
// Loja fechada: so o nome; cada pagina mostra o aviso e nao lista nada.
export default async function VitrineLayout({ children }: { children: ReactNode }) {
  const store = await getCurrentStore();
  const menu = isStoreOpen(store) ? await getMenu(store.id) : [];
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}>
      <header style={{ borderBottom: "1px solid #ddd", padding: "12px 0" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: "inherit", textDecoration: "none" }}>{store.name}</Link>
          {isStoreOpen(store) && (
            <form method="get" action="/buscar" role="search" style={{ display: "flex", gap: 4, flex: "1 1 200px", maxWidth: 400 }}>
              <input name="q" aria-label="Buscar produtos" placeholder="Buscar produtos" maxLength={80} style={{ flex: 1, minWidth: 0 }} />
              <button type="submit">Buscar</button>
            </form>
          )}
          {isStoreOpen(store) && <CartLink />}
        </div>
        {menu.length > 0 && (
          <nav aria-label="Categorias" style={{ marginTop: 8 }}>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 16 }}>
              {menu.map((c) => (
                <li key={c.id}>
                  <Link href={`/c/${c.slug}`}>{c.name}</Link>
                  {c.children.length > 0 && (
                    <ul style={{ listStyle: "none", paddingLeft: 8, margin: "4px 0 0", fontSize: 14 }}>
                      {c.children.map((k) => <li key={k.id}><Link href={`/c/${k.slug}`}>{k.name}</Link></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}
