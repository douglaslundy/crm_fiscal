import { redirect } from "next/navigation";
import type { MemberRole } from "@prisma/client";
import type { Session } from "next-auth";
import { getSession } from "@/auth";
import { prisma } from "./db";
import { dbForStore } from "./db-store";

// Contrato: cada guarda devolve a sessao ou chama redirect() (lanca NEXT_REDIRECT) para o login
// da populacao certa: /entrar (plataforma) ou /loja-entrar (loja). Vale em page, layout, server
// action e route handler (307). Permissao e relida do banco a cada chamada; o JWT so diz quem e.

/** Conta com isMaster=true no banco. Token de cliente nunca passa. */
export async function requireMaster(): Promise<Session> {
  const s = await getSession();
  if (s?.user.kind === "account") {
    const a = await prisma.account.findUnique({ where: { id: s.user.id }, select: { isMaster: true } });
    if (a?.isMaster) return s;
  }
  redirect("/entrar");
}

/** Membro (StoreMember) desta loja; role "OWNER" exige dono. Master passa em qualquer loja (suporte). */
export async function requireStoreMember(storeId: string, role?: MemberRole): Promise<Session> {
  const s = await getSession();
  if (s?.user.kind === "account") {
    const a = await prisma.account.findUnique({
      where: { id: s.user.id },
      select: { isMaster: true, memberships: { where: { storeId }, select: { role: true } } },
    });
    const m = a?.memberships[0];
    if (a?.isMaster || (m && (role !== "OWNER" || m.role === "OWNER"))) return s;
  }
  redirect("/entrar");
}

/** Cliente desta loja (token de outra loja ou de conta da plataforma nunca passa). */
export async function requireCustomer(storeId: string): Promise<Session> {
  const s = await getSession();
  if (s?.user.kind === "customer" && s.user.storeId === storeId) {
    if (await dbForStore(storeId).customer.findUnique({ where: { id: s.user.id }, select: { id: true } })) return s;
  }
  redirect("/loja-entrar");
}
