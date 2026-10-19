import { NextResponse } from "next/server";
import { ThemeBody, getTheme, updateTheme } from "@/domain/theme";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  return NextResponse.json(await getTheme(ctx.store.id));
}

/** Cor principal (#rrggbb) e logo (URL https); vazio volta ao padrao. */
export async function PATCH(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, ThemeBody);
  if ("res" in body) return body.res;
  try {
    await updateTheme(ctx.store.id, body.data);
    return NextResponse.json(await getTheme(ctx.store.id));
  } catch (e) {
    return domainError(e);
  }
}
