import type { Prisma, PrismaClient } from "@prisma/client";
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
    await tx.store.update({ where: { id: storeId }, data: { status: "SUSPENDED" } });
    await tx.subscription.updateMany({ where: { storeId }, data: { status: "SUSPENDED" } });
  });

/** Override manual/cortesia: forca ACTIVE e limpa a carencia. Uma preapproval real mantem o proprio estado no gateway e o proximo evento dele prevalece. */
export const reactivateStore = (storeId: string) =>
  locked(storeId, async (tx) => {
    await tx.store.update({ where: { id: storeId }, data: { status: "ACTIVE", graceEndsAt: null } });
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
