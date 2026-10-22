import { isStoreOpen } from "@/domain/catalog";
import { getCurrentStore } from "@/lib/tenant";
import { requestOrigin } from "@/lib/urls";

/** robots.txt da loja: loja fechada some dos buscadores; areas privadas nunca sao indexadas. */
export async function GET(req: Request) {
  const store = await getCurrentStore();
  const body = isStoreOpen(store)
    ? `User-agent: *\nDisallow: /carrinho\nDisallow: /checkout\nDisallow: /conta\nDisallow: /pedido\nDisallow: /admin\nDisallow: /api\n\nSitemap: ${requestOrigin(req.headers)}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
