import { Prisma, type Plan } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PlanNotFoundError } from "./stores";

export class PlanValidationError extends Error {}
export class PlanNameTakenError extends Error {}
export class PlanInUseError extends Error {}

export type PlanInput = {
  name: string; priceCents: number; productLimit: number | null; staffLimit: number;
  customDomain: boolean; advancedMetrics: boolean; csvExport: boolean; transactionFeeBps?: number;
};

const isInt = (n: unknown, min: number, max = Infinity) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

function validate(d: Partial<PlanInput>) {
  const bad =
    (d.name !== undefined && !d.name.trim()) ||
    (d.priceCents !== undefined && !isInt(d.priceCents, 0)) ||
    (d.productLimit != null && !isInt(d.productLimit, 1)) ||
    (d.staffLimit !== undefined && !isInt(d.staffLimit, 1)) ||
    (d.transactionFeeBps !== undefined && !isInt(d.transactionFeeBps, 0, 10000));
  if (bad) throw new PlanValidationError("Dados do plano inválidos.");
  return d.name === undefined ? d : { ...d, name: d.name.trim() };
}

const code = (e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined);

async function write<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    if (code(e) === "P2002") throw new PlanNameTakenError("Já existe um plano com este nome.");
    if (code(e) === "P2025") throw new PlanNotFoundError("Plano não encontrado.");
    throw e;
  }
}

// Unicidade sem diferenciar maiusculas ("pro" x "Pro"). O indice do banco e case-sensitive: corrida simultanea com
// nomes que so diferem em caixa ainda poderia passar (shortcut: aceitavel para painel de um unico operador).
async function assertNameFree(name: string | undefined, exceptId?: string) {
  if (name !== undefined && await prisma.plan.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) }, select: { id: true } }))
    throw new PlanNameTakenError("Já existe um plano com este nome.");
}

export const createPlan = async (input: PlanInput): Promise<Plan> => {
  const data = validate(input) as PlanInput;
  await assertNameFree(data.name);
  return write(() => prisma.plan.create({ data }));
};

// Sem cache: as lojas leem o plano a cada checagem de limites, entao a edicao vale na proxima.
export const updatePlan = async (id: string, input: Partial<PlanInput>): Promise<Plan> => {
  const data = validate(input);
  await assertNameFree(data.name, id);
  return write(() => prisma.plan.update({ where: { id }, data }));
};

export const setPlanActive = (id: string, active: boolean): Promise<Plan> => write(() => prisma.plan.update({ where: { id }, data: { active } }));

/** Plano com lojas nunca e excluido (desative). A FK Restrict garante mesmo sob corrida. */
export async function deletePlan(id: string): Promise<void> {
  if (await prisma.store.count({ where: { planId: id } })) throw new PlanInUseError("Plano em uso por lojas; desative em vez de excluir.");
  try {
    await prisma.plan.delete({ where: { id } });
  } catch (e) {
    // corrida (loja criada entre o count e o delete): o Prisma nem sempre mapeia o erro de FK para P2003
    if (code(e) === "P2003" || String(e).includes("foreign key")) throw new PlanInUseError("Plano em uso por lojas; desative em vez de excluir.");
    if (code(e) === "P2025") throw new PlanNotFoundError("Plano não encontrado.");
    throw e;
  }
}
