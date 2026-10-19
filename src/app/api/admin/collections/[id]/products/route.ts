import { NextResponse } from "next/server";
import { CollectionProducts, collectionProductIds, setCollectionProducts } from "@/domain/collections";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  return NextResponse.json({ productIds: await collectionProductIds(ctx.store.id, (await params).id) });
}

/** Troca o conjunto de produtos da colecao. */
export async function PUT(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, CollectionProducts);
  if ("res" in body) return body.res;
  try {
    await setCollectionProducts(ctx.store.id, (await params).id, body.data.productIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
