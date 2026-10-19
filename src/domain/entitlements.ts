import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";

export type PlanLimitCode = "PRODUCT_LIMIT" | "STAFF_LIMIT" | "DOMAIN_NOT_ALLOWED";

export class PlanLimitError extends Error {
  name = "PlanLimitError";
  constructor(readonly code: PlanLimitCode, readonly limit?: number) {
    super(code);
  }
}

export class StoreNotFoundError extends Error {
  name = "StoreNotFoundError";
}

// Sem cache: o plano e lido a cada chamada, entao trocar Store.planId vale na proxima.
async function planOf(storeId: string) {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { plan: true } });
  if (!store) throw new StoreNotFoundError(`Loja ${storeId} nao encontrada`);
  return store.plan;
}

// Cliente de transacao (so o que a checagem usa). Sem ele a checagem e so consultiva: checar e inserir em
// dbForStore(id).$transaction(tx => ..., { lockStore: true }) e o que impede duas criacoes simultaneas passarem do limite.
export type ProductCountTx = { product: { count(): Promise<number> } };
export type StaffCountTx = { storeMember: { count(args: { where: { storeId: string } }): Promise<number> } };

export async function assertCanAddProduct(storeId: string, tx?: ProductCountTx): Promise<void> {
  const { productLimit } = await planOf(storeId);
  if (productLimit === null) return;
  if ((await (tx ?? dbForStore(storeId)).product.count()) >= productLimit) throw new PlanLimitError("PRODUCT_LIMIT", productLimit);
}

export async function assertCanAddStaff(storeId: string, tx?: StaffCountTx): Promise<void> {
  const { staffLimit } = await planOf(storeId);
  if ((await (tx ?? prisma).storeMember.count({ where: { storeId } })) >= staffLimit) throw new PlanLimitError("STAFF_LIMIT", staffLimit);
}

export async function assertCanUseCustomDomain(storeId: string): Promise<void> {
  if (!(await planOf(storeId)).customDomain) throw new PlanLimitError("DOMAIN_NOT_ALLOWED");
}

export async function getFeatures(storeId: string): Promise<{ advancedMetrics: boolean; csvExport: boolean }> {
  const { advancedMetrics, csvExport } = await planOf(storeId);
  return { advancedMetrics, csvExport };
}

export function planLimitToHttp(error: PlanLimitError): { status: 403; body: { error: string; code: string; limit?: number; message: string } } {
  const { code, limit } = error;
  const message =
    code === "PRODUCT_LIMIT"
      ? `Seu plano permite até ${limit} ${limit === 1 ? "produto" : "produtos"}. Faça upgrade para continuar.`
      : code === "STAFF_LIMIT"
        ? `Seu plano permite até ${limit} ${limit === 1 ? "usuário" : "usuários"}. Faça upgrade para continuar.`
        : "Seu plano não inclui domínio próprio. Faça upgrade para continuar.";
  return { status: 403, body: { error: "PLAN_LIMIT", code, ...(limit === undefined ? {} : { limit }), message } };
}
