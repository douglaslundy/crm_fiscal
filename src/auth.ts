import type { NextAuthOptions, User } from "next-auth";
import { getServerSession } from "next-auth/next";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { resolveStoreByHost } from "@/lib/tenant";
import { isStoreBlocked } from "@/domain/subscription";
import { STORE_HOST_HEADER, platformDomain } from "@/lib/host";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";

// Duas populacoes de login (spec): contas da plataforma (master/lojistas) e clientes de UMA loja.
type Kind = "account" | "customer";
declare module "next-auth" {
  interface User { kind: Kind; isMaster?: boolean; storeId?: string }
  interface Session {
    user: { id: string; kind: Kind; pwv?: number; name?: string | null; email?: string | null; isMaster?: boolean; storeId?: string };
  }
}
declare module "next-auth/jwt" {
  interface JWT { id: string; kind: Kind; isMaster?: boolean; storeId?: string; pwv?: number }
}

type Creds = Partial<Record<string, string>> | undefined;
// Hash de senha que nao existe: comparado quando o usuario nao existe, para o tempo nao revelar o email.
const DUMMY_HASH = "$2b$10$Xh98qY52uyhAuNEaIR8nB.RA/DLv60q2debT26VvKk0egLQK3qZya";
const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");

/** Segredo do JWT: obrigatorio fora de teste (o next-auth v4 deriva um segredo adivinhavel fora de producao). */
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "test") return "segredo-fixo-so-para-testes";
  throw new Error("AUTH_SECRET nao definido: gere com `openssl rand -base64 32` e defina no ambiente");
}

/** Erro de login por excesso de tentativas (o formulario mostra a mensagem propria). */
export const TOO_MANY_ATTEMPTS = "MUITAS_TENTATIVAS";
// Toda tentativa conta (inclusive as que falham): 10 por 15 min por IP + email.
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });
function throttle(key: string) {
  if (!loginLimiter.check(key).ok) throw new Error(TOO_MANY_ATTEMPTS);
}
const ipOf = (h: Record<string, unknown> | undefined) =>
  clientIp(new Headers(Object.entries(h ?? {}).filter((e): e is [string, string] => typeof e[1] === "string")));

async function passwordOk(password: unknown, hash: string | undefined) {
  const ok = await bcrypt.compare(typeof password === "string" ? password : "", hash ?? DUMMY_HASH);
  return ok && hash !== undefined;
}

/** Conta da plataforma. Erro unico (null) para email inexistente ou senha errada. */
export async function authorizeAccount(c: Creds, ip = "unknown"): Promise<User | null> {
  const email = normEmail(c?.email);
  throttle(`account|${ip}|${email}`);
  const a = email ? await prisma.account.findUnique({ where: { email } }) : null;
  if (!(await passwordOk(c?.password, a?.passwordHash)) || !a) return null;
  return { id: a.id, name: a.name, email: a.email, kind: "account", isMaster: a.isMaster };
}

/** "Versao da senha": instante da ultima troca (0 = nunca trocada). O JWT guarda o valor do login; trocar a senha invalida as sessoes antigas. */
export async function passwordVersion(kind: Kind, id: string): Promise<number | null> {
  const row = kind === "account"
    ? await prisma.account.findUnique({ where: { id }, select: { passwordChangedAt: true } })
    : await prisma.customer.findUnique({ where: { id }, select: { passwordChangedAt: true } });
  return row ? (row.passwordChangedAt?.getTime() ?? 0) : null;
}

/** Cliente da loja do host (nunca de campo do formulario): mesmo email em outra loja e outra conta. Loja SUSPENDED/CANCELED recusa. */
export async function authorizeCustomer(c: Creds, host: string | undefined, ip = "unknown"): Promise<User | null> {
  const found = host ? await resolveStoreByHost(host, platformDomain()) : null;
  const store = found && !isStoreBlocked(found) ? found : null; // loja suspensa/cancelada nao aceita login
  const email = normEmail(c?.email);
  throttle(`customer|${store?.id ?? "-"}|${ip}|${email}`);
  const cu = store && email
    ? await dbForStore(store.id).customer.findUnique({ where: { storeId_email: { storeId: store.id, email } } })
    : null;
  if (!(await passwordOk(c?.password, cu?.passwordHash)) || !cu) return null;
  return { id: cu.id, name: cu.name, email: cu.email, kind: "customer", storeId: cu.storeId };
}

const credentials = {
  email: { label: "E-mail", type: "email" },
  password: { label: "Senha", type: "password" },
};

export const authOptions: NextAuthOptions = {
  // getter: lido a cada uso (requisicao), entao `next build` sem segredos nao quebra; requisicao sem AUTH_SECRET falha alto.
  get secret() {
    return authSecret();
  },
  session: { strategy: "jwt" },
  pages: { signIn: "/entrar" },
  providers: [
    CredentialsProvider({ id: "account", name: "Conta da plataforma", credentials, authorize: (c, req) => authorizeAccount(c, ipOf(req.headers)) }),
    CredentialsProvider({
      id: "customer",
      name: "Cliente da loja",
      credentials,
      // header definido so pelo middleware (o valor do cliente e descartado la)
      authorize: (c, req) => authorizeCustomer(c, req.headers?.[STORE_HOST_HEADER], ipOf(req.headers)),
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) Object.assign(token, { id: user.id, kind: user.kind, isMaster: user.isMaster, storeId: user.storeId, pwv: (await passwordVersion(user.kind, user.id)) ?? 0 });
      return token;
    },
    session({ session, token }) {
      const extra = token.kind === "account" ? { isMaster: token.isMaster } : { storeId: token.storeId };
      session.user = { id: token.id, kind: token.kind, name: token.name, email: token.email, pwv: token.pwv ?? 0, ...extra };
      return session;
    },
  },
};

/** Sessao valida: a senha nao mudou desde o login (conta apagada tambem invalida). */
export async function getSession() {
  const s = await getServerSession(authOptions);
  if (!s?.user) return s;
  return (await passwordVersion(s.user.kind, s.user.id)) === (s.user.pwv ?? 0) ? s : null;
}
