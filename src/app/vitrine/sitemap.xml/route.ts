import { isStoreOpen } from "@/domain/catalog";
import { dbForStore } from "@/lib/db-store";
import { getCurrentStore } from "@/lib/tenant";
import { requestOrigin } from "@/lib/urls";

const LIMIT = 5000; // teto do protocolo: 50 mil URLs por arquivo; mais que isso exigiria indice de sitemaps

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Sitemap da loja: home, categorias, colecoes ativas e produtos ativos com variacao ativa. Loja fechada: vazio. */
export async function GET(req: Request) {
  const store = await getCurrentStore();
  const origin = requestOrigin(req.headers);
  const paths = ["/"];
  if (isStoreOpen(store)) {
    const db = dbForStore(store.id);
    const [categories, collections, products] = await Promise.all([
      db.category.findMany({ select: { slug: true }, take: LIMIT }),
      db.collection.findMany({ where: { active: true }, select: { slug: true }, take: LIMIT }),
      db.product.findMany({ where: { active: true, variants: { some: { active: true } } }, select: { slug: true }, take: LIMIT }),
    ]);
    paths.push(...categories.map((c) => `/c/${c.slug}`), ...collections.map((c) => `/colecao/${c.slug}`), ...products.map((p) => `/p/${p.slug}`));
  }
  const urls = (isStoreOpen(store) ? paths : []).slice(0, LIMIT).map((p) => `<url><loc>${esc(origin + p)}</loc></url>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
