import { NextResponse } from "next/server";
import { isPlatformHost, platformDomain } from "@/lib/host";
import { resolveStoreByHost } from "@/lib/tenant";

/** Caddy (`on_demand_tls ask`): so emite certificado para o dominio da plataforma e para hosts de lojas existentes (subdominio ou dominio proprio verificado). */
export async function GET(req: Request) {
  // Chamada interna do Caddy nao traz X-Forwarded-For; pedido vindo da internet (via proxy) traz.
  if (req.headers.get("x-forwarded-for")) return new NextResponse(null, { status: 404 });
  const domain = new URL(req.url).searchParams.get("domain") ?? "";
  const ok = isPlatformHost(domain, platformDomain()) || !!(await resolveStoreByHost(domain, platformDomain()));
  return new NextResponse(null, { status: ok ? 200 : 404 });
}
