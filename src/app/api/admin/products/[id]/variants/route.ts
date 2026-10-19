import { NextResponse } from "next/server";
import { VariantCreate } from "@/domain/products";
import { addVariant } from "@/domain/productVariants";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, VariantCreate);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await addVariant(ctx.store.id, (await params).id, body.data), { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
