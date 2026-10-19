import { NextResponse } from "next/server";
import { OrderPatch, updateOrder } from "@/domain/adminOrders";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, OrderPatch);
  if ("res" in body) return body.res;
  try {
    const o = await updateOrder(ctx.store.id, (await params).id, body.data);
    return NextResponse.json({ id: o.id, status: o.status, trackingCode: o.trackingCode });
  } catch (e) {
    return domainError(e);
  }
}
