import type { Prisma, PrismaClient, StoreStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { StoreNotFoundError } from "./entitlements";
import { PlanNotFoundError, createStore, type CreateStoreInput } from "./stores";
import { lockStores } from "./subscription";

export type MasterStoreInput = CreateStoreInput & { startMode: "trial" | "active" };

/** Painel master: mesmas regras de slug/plano do cadastro publico; reutiliza conta existente (senha ignorada). */
export function createStoreAsMaster(input: MasterStoreInput, deps: { db: PrismaClient; now?: () => Date }) {
  const { startMode, ...rest } = input;
  return createStore(rest, { ...deps, allowExistingAccount: true, startMode });
}

// Toda acao trava a linha da Store (FOR UPDATE) na mesma transacao, como applyBillingEvent/cron: sem corrida.
async function locked<T>(storeId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockStores(tx, [storeId]);
    if (!(await tx.store.findUnique({ where: { id: storeId }, select: { id: true } }))) throw new StoreNotFoundError(`Loja ${storeId} nao encontrada`);
    return fn(tx);
  });
}

export const suspendStore = (storeId: string) =>
  locked(storeId, async (tx) => {
    await tx.store.update({ where: { id: storeId }, data: { status: "SUSPENDED", suspendedByMaster: true } }); // evento do gateway nao reativa
    await tx.subscription.updateMany({ where: { storeId }, data: { status: "SUSPENDED" } });
  });

/** Override manual/cortesia: forca ACTIVE e limpa a carencia. Uma preapproval real mantem o proprio estado no gateway e o proximo evento dele prevalece. */
export const reactivateStore = (storeId: string) =>
  locked(storeId, async (tx) => {
    await tx.store.update({ where: { id: storeId }, data: { status: "ACTIVE", graceEndsAt: null, suspendedByMaster: false } });
    await tx.subscription.updateMany({ where: { storeId }, data: { status: "ACTIVE" } });
  });

/** Troca so Store.planId (limites/recursos na proxima checagem); o gateway de cobranca NAO e tocado (valor cobrado nao muda). */
export const changeStorePlan = (storeId: string, planId: string) =>
  locked(storeId, async (tx) => {
    if (!(await tx.plan.findFirst({ where: { id: planId, active: true }, select: { id: true } }))) throw new PlanNotFoundError("Plano inexistente ou inativo.");
    await tx.store.update({ where: { id: storeId }, data: { planId } });
  });

export const updateStore = (storeId: string, data: { name?: string }) =>
  locked(storeId, async (tx) => {
    await tx.store.update({ where: { id: storeId }, data: { name: data.name } });
  });

export type StoreFilters = { status?: StoreStatus; planId?: string; q?: string; page?: number };
export const PAGE_SIZE = 25;

/** Lista paginada (25/pagina) com busca por nome, slug ou e-mail do dono. */
export async function listStores(f: StoreFilters) {
  const q = f.q?.trim();
  const where: Prisma.StoreWhereInput = {
    ...(f.status && { status: f.status }),
    ...(f.planId && { planId: f.planId }),
    ...(q && {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { members: { some: { role: "OWNER", account: { email: { contains: q, mode: "insensitive" } } } } },
      ],
    }),
  };
  const page = Math.max(1, Math.floor(f.page ?? 1) || 1);
  const [total, rows] = await Promise.all([
    prisma.store.count({ where }),
    prisma.store.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE,
      include: { plan: { select: { name: true } }, members: { where: { role: "OWNER" }, select: { account: { select: { email: true } } } } },
    }),
  ]);
  return {
    page, total, pageSize: PAGE_SIZE,
    stores: rows.map((s) => ({
      id: s.id, slug: s.slug, name: s.name, status: s.status, planName: s.plan.name,
      ownerEmail: s.members[0]?.account.email ?? null, trialEndsAt: s.trialEndsAt, createdAt: s.createdAt,
    })),
  };
}
