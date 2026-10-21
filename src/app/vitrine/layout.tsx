import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getMenu, isStoreOpen } from "@/domain/catalog";
import { getActiveCollections } from "@/domain/collections";
import { getCurrentStore } from "@/lib/tenant";
import { CartLink } from "./cart-link";
import { getTheme, textOn } from "@/domain/theme";
import { SubscribeForm } from "./subscribe-form";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: (await getCurrentStore()).name };
}

// Vitrine publica (sem login). Rotas publicas da loja chegam aqui pela reescrita do middleware.
// Loja fechada: so o nome; cada pagina mostra o aviso e nao lista nada.
export default async function VitrineLayout({ children }: { children: ReactNode }) {
  const store = await getCurrentStore();
  const [menu, collections] = isStoreOpen(store) ? await Promise.all([getMenu(store.id), getActiveCollections(store.id)]) : [[], []];
  const theme = await getTheme(store.id);
  const open = isStoreOpen(store);
  return (
    <div style={theme.primaryColor ? ({ "--primary": theme.primaryColor, "--on-primary": textOn(theme.primaryColor) } as CSSProperties) : undefined}>
      <header className="site-header">
        <div className="container">
          <div className="bar">
            <Link href="/" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element -- logo enviado pelo lojista */}
              {theme.logoUrl && <img src={theme.logoUrl} alt="" />}
              {store.name}
            </Link>
            {open && (
              <form method="get" action="/buscar" role="search" className="search">
                <input name="q" aria-label="Buscar produtos" placeholder="Buscar produtos" maxLength={80} />
                <button type="submit">Buscar</button>
              </form>
            )}
            {open && (
              <div className="header-links">
                <Link href="/conta">Minha conta</Link>
                <CartLink />
              </div>
            )}
          </div>
          {(collections.length > 0 || menu.length > 0) && (
            <nav aria-label="Categorias e coleções" className="subnav">
              {collections.map((c) => <Link key={c.id} href={`/colecao/${c.slug}`}>{c.name}</Link>)}
              {menu.map((c) => (
                <span key={c.id}>
                  <Link href={`/c/${c.slug}`}>{c.name}</Link>
                  {c.children.length > 0 && (
                    <span className="sub">{c.children.map((k, i) => <span key={k.id}>{i > 0 && " · "}<Link href={`/c/${k.slug}`}>{k.name}</Link></span>)}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
        </div>
      </header>
      <div className="container">{children}</div>
      {open && <footer className="site-footer"><div className="container"><SubscribeForm /><p style={{ margin: "12px 0 0" }}><Link href="/termos">Termos de compra</Link> · <Link href="/privacidade">Privacidade</Link></p></div></footer>}
    </div>
  );
}
