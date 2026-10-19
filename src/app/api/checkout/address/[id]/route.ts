import { NextResponse } from "next/server";
import { z } from "zod";
import { AddressInput, deleteAddress, updateAddress } from "@/domain/account";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { err } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

/** Edita endereco do cliente logado; de outro cliente/loja = 404. */
export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = AddressInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.", { fields: z.flattenError(parsed.error).fieldErrors });
  const address = await updateAddress(ctx.store.id, ctx.customerId, (await params).id, parsed.data);
  return address ? NextResponse.json(address) : err(404, "Não encontrado.");
}

export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  return (await deleteAddress(ctx.store.id, ctx.customerId, (await params).id)) ? new NextResponse(null, { status: 204 }) : err(404, "Não encontrado.");
}
