import bcrypt from "bcryptjs";
import { Prisma, type Account, type PrismaClient, type Store } from "@prisma/client";
import { prisma } from "@/lib/db";
import { slugify } from "./slug";

export const TRIAL_DAYS = 14;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "master", "admin", "app", "mail", "ftp", "static", "assets", "loja", "plataforma", "entrar", "cadastro", "comecar"]);
const DEFAULT_SETTINGS = [["originCep", "37175000"], ["pixDiscountPercent", "0"]] as const;

export class SlugTakenError extends Error {}
export class SlugInvalidError extends Error {}
export class EmailExistsError extends Error {}
export class PlanNotFoundError extends Error {}

export type CreateStoreInput = { ownerName: string; email: string; password: string; storeName: string; slug?: string; planId: string };

const isValidSlug = (s: string) => SLUG_RE.test(s) && !RESERVED.has(s);

export async function isSlugAvailable(slug: string): Promise<boolean> {
  return isValidSlug(slug) && !(await prisma.store.findUnique({ where: { slug }, select: { id: true } }));
}

export async function createStore(
  input: CreateStoreInput,
  deps: { db: PrismaClient; now?: () => Date },
): Promise<{ store: Store; account: Account }> {
  const slug = input.slug ?? slugify(input.storeName);
  if (!isValidSlug(slug)) throw new SlugInvalidError("Slug inválido ou reservado.");
  const email = input.email.trim().toLowerCase();
  const now = (deps.now ?? (() => new Date()))();
  const passwordHash = await bcrypt.hash(input.password, 10);

  try {
    return await deps.db.$transaction(async (tx) => {
      const plan = await tx.plan.findFirst({ where: { id: input.planId, active: true }, select: { id: true } });
      if (!plan) throw new PlanNotFoundError("Plano inexistente ou inativo.");
      const account = await tx.account.create({ data: { name: input.ownerName, email, passwordHash } });
      const store = await tx.store.create({
        data: { slug, name: input.storeName, status: "TRIAL", planId: plan.id, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86400_000) },
      });
      await tx.storeMember.create({ data: { storeId: store.id, accountId: account.id, role: "OWNER" } });
      await tx.subscription.create({ data: { storeId: store.id, status: "TRIALING" } });
      // Bootstrap de plataforma: a loja acaba de nascer, entao grava as configuracoes iniciais com storeId explicito (sem dbForStore).
      await tx.storeSetting.createMany({ data: DEFAULT_SETTINGS.map(([key, value]) => ({ storeId: store.id, key, value })) });
      return { store, account };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String(e.meta?.target ?? "");
      if (target.includes("email")) throw new EmailExistsError("E-mail já cadastrado.");
      if (target.includes("slug")) throw new SlugTakenError("Endereço da loja já em uso.");
    }
    throw e;
  }
}
