/** Origem publica (esquema + porta) vem de NEXTAUTH_URL; a loja usa o subdominio `slug.<PLATFORM_DOMAIN>`. */
function base(): URL {
  return new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000");
}

/** Origem que o visitante usou (Host do pedido + esquema configurado); serve loja com subdominio ou dominio proprio. */
export const requestOrigin = (h: Headers) => `${base().protocol}//${h.get("host") ?? base().host}`;

export const platformOrigin = () => base().origin;

export function storeOrigin(slug: string): string {
  const u = base();
  const domain = process.env.PLATFORM_DOMAIN ?? u.hostname;
  return `${u.protocol}//${slug}.${domain}${u.port ? `:${u.port}` : ""}`;
}
