import { NextResponse, type NextRequest } from "next/server";
import { STORE_HOST_HEADER, isPlatformHost, normalizeHost, platformDomain } from "@/lib/host";
import { storefrontPath } from "@/lib/storefront-routes";

// Sem banco: so classifica o host. Loja -> header x-store-host para getCurrentStore();
// plataforma -> segue sem o header. Host desconhecido vira 404 neutro em getCurrentStore().
// Loja: caminhos publicos ("/", /c/*, /p/*, /buscar, /carrinho, /checkout, /pedido/<id>) sao reescritos para /vitrine/* (a "/" fisica e da plataforma).
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete(STORE_HOST_HEADER); // valor vindo do cliente nunca e confiavel
  const host = normalizeHost(req.headers.get("host"));
  if (!host || isPlatformHost(host, platformDomain())) return NextResponse.next({ request: { headers } });
  headers.set(STORE_HOST_HEADER, host);
  const path = storefrontPath(req.nextUrl.pathname);
  if (!path) return NextResponse.next({ request: { headers } });
  const url = req.nextUrl.clone();
  url.pathname = path;
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
