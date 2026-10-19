import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeCep } from "@/domain/cep";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { dbForStore } from "@/lib/db-store";
import { err } from "@/lib/master-api";

const SELECT = { id: true, cep: true, street: true, number: true, complement: true, district: true, city: true, state: true } as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const Body = z.object({
  cep: z.string().max(20).transform((c, ctx) => normalizeCep(c) ?? (ctx.addIssue({ code: "custom", message: "CEP inválido" }), z.NEVER)),
  street: text(120),
  number: text(20),
  complement: z.string().trim().max(120).optional().transform((c) => c || null),
  district: text(80),
  city: text(80),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
});

/** Enderecos do cliente logado (so os dele, so desta loja). */
export async function GET(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const addresses = await dbForStore(ctx.store.id).address.findMany({ where: { customerId: ctx.customerId }, select: SELECT, orderBy: { id: "asc" } });
  return NextResponse.json({ addresses });
}

/** Novo endereco para o cliente logado (dono vem da sessao, nunca do corpo). */
export async function POST(req: Request) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.", { fields: z.flattenError(parsed.error).fieldErrors });
  const address = await dbForStore(ctx.store.id).address.create({ data: { ...parsed.data, storeId: ctx.store.id, customerId: ctx.customerId }, select: SELECT });
  return NextResponse.json(address, { status: 201 });
}
