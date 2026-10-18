import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings } from "@/domain/storeSettings";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

// CEP e faixa do desconto sao validados no dominio; aqui so o formato do JSON. OWNER e STAFF podem alterar.
const Body = z.object({ originCep: z.string().optional(), pixDiscountPercent: z.number().optional() });

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  return NextResponse.json(await getSettings(ctx.store.id));
}

export async function PATCH(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, Body);
  if ("res" in body) return body.res;
  try {
    await updateSettings(ctx.store.id, body.data);
    return NextResponse.json(await getSettings(ctx.store.id));
  } catch (e) {
    return domainError(e);
  }
}
