import { NextResponse } from "next/server";
import { createCategory, listCategories } from "@/domain/categories";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";
import { CategoryBody } from "./body";

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  return NextResponse.json(await listCategories(ctx.store.id));
}

export async function POST(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, CategoryBody);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await createCategory(ctx.store.id, body.data), { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
