import { NextResponse } from "next/server";
import { ProductCreate, createProduct, listProducts, parseProductQuery } from "@/domain/products";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, err, parseBody } from "@/lib/master-api";

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  const query = parseProductQuery(new URL(req.url).searchParams);
  if (!query) return err(400, "Filtros inválidos.");
  return NextResponse.json(await listProducts(ctx.store.id, query));
}

export async function POST(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, ProductCreate);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await createProduct(ctx.store.id, body.data), { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
