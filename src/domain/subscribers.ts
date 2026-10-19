import { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbForStore } from "@/lib/db-store";
import { csvCell } from "./metrics";

export class SubscriberNotFoundError extends Error {
  name = "SubscriberNotFoundError";
}

export const EXPORT_CAP = 20000;
export const LIST_CAP = 200;

/** Consentimento explicito (LGPD): sem `consent: true` nao cadastra. */
export const SubscribeBody = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  consent: z.literal(true),
});

/** Idempotente: e-mail repetido na loja nao duplica nem avisa (quem chama sempre responde ok). */
export async function subscribe(storeId: string, email: string): Promise<void> {
  try {
    await dbForStore(storeId).subscriber.create({ data: { storeId, email } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}

export async function listSubscribers(storeId: string) {
  const db = dbForStore(storeId);
  const [items, total] = await Promise.all([
    db.subscriber.findMany({ select: { id: true, email: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: LIST_CAP }),
    db.subscriber.count(),
  ]);
  return { items, total };
}

export async function removeSubscriber(storeId: string, id: string): Promise<void> {
  const { count } = await dbForStore(storeId).subscriber.deleteMany({ where: { id } });
  if (count === 0) throw new SubscriberNotFoundError("Inscrito não encontrado");
}

/** CSV (email,data) dos mais recentes ate EXPORT_CAP, cronologico. */
export async function exportSubscribersCsv(storeId: string): Promise<string> {
  const rows = await dbForStore(storeId).subscriber.findMany({
    select: { email: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: EXPORT_CAP,
  });
  rows.reverse();
  return ["email,inscrito_em", ...rows.map((r) => [r.email, r.createdAt.toISOString()].map(csvCell).join(","))].join("\r\n") + "\r\n";
}
