import { NextResponse } from "next/server";
import { VariantPatch } from "@/domain/products";
import { deleteVariant, updateVariant } from "@/domain/productVariants";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string; variantId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, VariantPatch);
  if ("res" in body) return body.res;
  try {
    const { id, variantId } = await params;
    return NextResponse.json(await updateVariant(ctx.store.id, id, variantId, body.data));
  } catch (e) {
    return domainError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  try {
    const { id, variantId } = await params;
    return NextResponse.json(await deleteVariant(ctx.store.id, id, variantId));
  } catch (e) {
    return domainError(e);
  }
}
