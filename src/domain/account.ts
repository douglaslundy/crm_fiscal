import { z } from "zod";
import { normalizeCep } from "./cep";
import { dbForStore } from "@/lib/db-store";

export const ADDRESS_SELECT = { id: true, cep: true, street: true, number: true, complement: true, district: true, city: true, state: true } as const;
const text = (max: number) => z.string().trim().min(1).max(max);
export const AddressInput = z.object({
  cep: z.string().max(20).transform((c, ctx) => normalizeCep(c) ?? (ctx.addIssue({ code: "custom", message: "CEP inválido" }), z.NEVER)),
  street: text(120),
  number: text(20),
  complement: z.string().trim().max(120).nullish().transform((c) => c || null),
  district: text(80),
  city: text(80),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
});
export type AddressInput = z.infer<typeof AddressInput>;

// Toda consulta: loja (dbForStore) + dono (customerId da sessao). Fora disso = null/false (a rota responde 404).
export const listOrders = (storeId: string, customerId: string) =>
  dbForStore(storeId).order.findMany({
    where: { customerId }, orderBy: { createdAt: "desc" },
    select: { id: true, status: true, totalCents: true, createdAt: true },
  });

export async function getOrder(storeId: string, customerId: string, id: string) {
  const db = dbForStore(storeId);
  const order = await db.order.findFirst({
    where: { id, customerId },
    select: { id: true, status: true, subtotalCents: true, shippingCents: true, totalCents: true, shippingService: true, trackingCode: true, addressSnapshot: true, createdAt: true },
  });
  if (!order) return null;
  const items = await db.orderItem.findMany({
    where: { orderId: order.id },
    select: { id: true, productName: true, color: true, size: true, quantity: true, unitPriceCents: true },
  });
  return { ...order, items };
}

export const listAddresses = (storeId: string, customerId: string) =>
  dbForStore(storeId).address.findMany({ where: { customerId }, select: ADDRESS_SELECT, orderBy: { id: "asc" } });

/** Atualiza e devolve na mesma instrucao (sem janela para apagar entre gravar e reler). */
export async function updateAddress(storeId: string, customerId: string, id: string, data: AddressInput) {
  const [a] = await dbForStore(storeId).address.updateManyAndReturn({ where: { id, customerId }, data, select: ADDRESS_SELECT });
  return a ?? null;
}

// Pedidos guardam addressSnapshot (sem FK para Address): apagar o endereco nao afeta o historico.
export async function deleteAddress(storeId: string, customerId: string, id: string) {
  return (await dbForStore(storeId).address.deleteMany({ where: { id, customerId } })).count > 0;
}
