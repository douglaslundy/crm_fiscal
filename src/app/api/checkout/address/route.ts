import { NextResponse } from "next/server";
import { z } from "zod";
import { ADDRESS_SELECT as SELECT, AddressInput as Body, listAddresses } from "@/domain/account";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { dbForStore } from "@/lib/db-store";
import { err } from "@/lib/master-api";

const MAX_ADDRESSES = 20;

/** Enderecos do cliente logado (so os dele, so desta loja). */
export async function GET(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const addresses = await listAddresses(ctx.store.id, ctx.customerId);
  return NextResponse.json({ addresses });
}

/** Novo endereco para o cliente logado (dono vem da sessao, nunca do corpo). */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.", { fields: z.flattenError(parsed.error).fieldErrors });
  const db = dbForStore(ctx.store.id);
  // shortcut: contagem fora de transacao; envios simultaneos podem passar 1-2 do limite (inofensivo).
  if ((await db.address.count({ where: { customerId: ctx.customerId } })) >= MAX_ADDRESSES) return err(422, "LIMITE_DE_ENDERECOS");
  const address = await db.address.create({ data: { ...parsed.data, storeId: ctx.store.id, customerId: ctx.customerId }, select: SELECT });
  return NextResponse.json(address, { status: 201 });
}
