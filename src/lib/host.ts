// Puro (sem banco): usado pelo middleware (edge) e por tenant.ts.

/** Minusculas, sem espacos, sem porta e sem ponto final. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Dominio nu da plataforma ou www: nao sao lojas. */
export function isPlatformHost(host: string, platformDomain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(platformDomain);
  return h === d || h === `www.${d}`;
}

/** Header interno com o host da loja; definido so pelo middleware. */
export const STORE_HOST_HEADER = "x-store-host";
export const platformDomain = () => process.env.PLATFORM_DOMAIN ?? "localhost";
