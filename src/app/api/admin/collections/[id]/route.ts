import { NextResponse } from "next/server";
import { CollectionPatch, deleteCollection, updateCollection } from "@/domain/collections";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, CollectionPatch);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await updateCollection(ctx.store.id, (await params).id, body.data));
  } catch (e) {
    return domainError(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  try {
    await deleteCollection(ctx.store.id, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
