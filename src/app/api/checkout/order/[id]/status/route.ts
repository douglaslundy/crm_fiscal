import { NextResponse } from "next/server";
import { denyUnlessCustomer } from "@/lib/customer-api";
import { dbForStore } from "@/lib/db-store";
import { err } from "@/lib/master-api";

/** Status do pedido do proprio cliente (polling da pagina do pedido). QR em base64 nao e guardado: so o copia-e-cola. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await denyUnlessCustomer(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const order = await dbForStore(ctx.store.id).order.findFirst({
    where: { id, customerId: ctx.customerId },
    select: { status: true, pixQrCode: true, pixExpiresAt: true },
  });
  return order ? NextResponse.json(order) : err(404, "Não encontrado.");
}
