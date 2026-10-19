import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Store } from "@prisma/client";
import { prisma } from "./db";
import { STORE_HOST_HEADER, isPlatformHost, normalizeHost, platformDomain } from "./host";

/** `slug.<dominio da plataforma>` ou StoreDomain.host verificado de loja cujo plano inclui dominio proprio; senao null. */
export async function resolveStoreByHost(host: string, platformDomain: string): Promise<Store | null> {
  const h = normalizeHost(host);
  const d = normalizeHost(platformDomain);
  if (!h || isPlatformHost(h, d)) return null;
  if (h.endsWith(`.${d}`)) {
    const slug = h.slice(0, -(d.length + 1));
    return slug.includes(".") ? null : prisma.store.findUnique({ where: { slug } });
  }
  // shortcut: StoreDomain.host deve ser gravado ja normalizado (minusculas), senao nao casa.
  const dom = await prisma.storeDomain.findUnique({ where: { host: h }, include: { store: { include: { plan: { select: { customDomain: true } } } } } });
  if (!dom?.verified || !dom.store.plan.customDomain) return null; // plano rebaixado: dominio proprio sai do ar
  const { plan: _plan, ...store } = dom.store; // eslint-disable-line @typescript-eslint/no-unused-vars
  return store;
}

/** Loja da requisicao atual (host encaminhado pelo middleware); 404 neutro se nao houver. */
export const getCurrentStore = cache(async (): Promise<Store> => {
  const host = (await headers()).get(STORE_HOST_HEADER);
  const store = host ? await resolveStoreByHost(host, platformDomain()) : null;
  if (!store) notFound();
  return store;
});
