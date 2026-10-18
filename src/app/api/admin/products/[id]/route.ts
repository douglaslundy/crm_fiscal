import { NextResponse } from "next/server";
import { ProductPatch, deleteProduct, getProduct, updateProduct } from "@/domain/products";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  try {
    return NextResponse.json(await getProduct(ctx.store.id, (await params).id));
  } catch (e) {
    return domainError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, ProductPatch);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await updateProduct(ctx.store.id, (await params).id, body.data));
  } catch (e) {
    return domainError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  try {
    await deleteProduct(ctx.store.id, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
