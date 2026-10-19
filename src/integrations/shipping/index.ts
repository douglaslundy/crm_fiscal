import { FakeShipping } from "./fakeShipping";
import { MelhorEnvioShipping } from "./melhorEnvio";
import type { ShippingProvider } from "./types";

/** Token da loja -> Melhor Envio. Sem token: FakeShipping so fora de producao; em producao null (rota responde FRETE_NAO_CONFIGURADO). */
export function getShippingProvider(token: string | undefined): ShippingProvider | null {
  if (token) return new MelhorEnvioShipping({ token });
  return process.env.NODE_ENV === "production" ? null : new FakeShipping();
}
