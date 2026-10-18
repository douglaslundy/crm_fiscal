import { NextResponse, type NextRequest } from "next/server";
import { STORE_HOST_HEADER, isPlatformHost, normalizeHost, platformDomain } from "@/lib/host";

// Sem banco (edge): so classifica o host. Loja -> header x-store-host para getCurrentStore();
// plataforma -> segue sem o header. Host desconhecido vira 404 neutro em getCurrentStore().
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.delete(STORE_HOST_HEADER); // valor vindo do cliente nunca e confiavel
  const host = normalizeHost(req.headers.get("host"));
  if (host && !isPlatformHost(host, platformDomain())) headers.set(STORE_HOST_HEADER, host);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
