import type { NextAuthOptions, User } from "next-auth";
import { getServerSession } from "next-auth/next";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { resolveStoreByHost } from "@/lib/tenant";
import { STORE_HOST_HEADER, platformDomain } from "@/lib/host";

// Duas populacoes de login (spec): contas da plataforma (master/lojistas) e clientes de UMA loja.
type Kind = "account" | "customer";
declare module "next-auth" {
  interface User { kind: Kind; isMaster?: boolean; storeId?: string }
  interface Session {
    user: { id: string; kind: Kind; name?: string | null; email?: string | null; isMaster?: boolean; storeId?: string };
  }
}
declare module "next-auth/jwt" {
  interface JWT { id: string; kind: Kind; isMaster?: boolean; storeId?: string }
}

type Creds = Partial<Record<string, string>> | undefined;
// Hash de senha que nao existe: comparado quando o usuario nao existe, para o tempo nao revelar o email.
const DUMMY_HASH = "$2b$10$Xh98qY52uyhAuNEaIR8nB.RA/DLv60q2debT26VvKk0egLQK3qZya";
const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");

async function passwordOk(password: unknown, hash: string | undefined) {
  const ok = await bcrypt.compare(typeof password === "string" ? password : "", hash ?? DUMMY_HASH);
  return ok && hash !== undefined;
}

/** Conta da plataforma. Erro unico (null) para email inexistente ou senha errada. */
export async function authorizeAccount(c: Creds): Promise<User | null> {
  const email = normEmail(c?.email);
  const a = email ? await prisma.account.findUnique({ where: { email } }) : null;
  if (!(await passwordOk(c?.password, a?.passwordHash)) || !a) return null;
  return { id: a.id, name: a.name, email: a.email, kind: "account", isMaster: a.isMaster };
}

/** Cliente da loja do host (nunca de campo do formulario): mesmo email em outra loja e outra conta. */
export async function authorizeCustomer(c: Creds, host: string | undefined): Promise<User | null> {
  const store = host ? await resolveStoreByHost(host, platformDomain()) : null;
  const email = normEmail(c?.email);
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
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/entrar" },
  providers: [
    CredentialsProvider({ id: "account", name: "Conta da plataforma", credentials, authorize: (c) => authorizeAccount(c) }),
    CredentialsProvider({
      id: "customer",
      name: "Cliente da loja",
      credentials,
      // header definido so pelo middleware (o valor do cliente e descartado la)
      authorize: (c, req) => authorizeCustomer(c, req.headers?.[STORE_HOST_HEADER]),
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) Object.assign(token, { id: user.id, kind: user.kind, isMaster: user.isMaster, storeId: user.storeId });
      return token;
    },
    session({ session, token }) {
      const extra = token.kind === "account" ? { isMaster: token.isMaster } : { storeId: token.storeId };
      session.user = { id: token.id, kind: token.kind, name: token.name, email: token.email, ...extra };
      return session;
    },
  },
};

export const getSession = () => getServerSession(authOptions);
