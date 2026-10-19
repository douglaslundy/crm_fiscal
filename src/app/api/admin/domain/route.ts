import { NextResponse } from "next/server";
import { z } from "zod";
import { getDomain, setDomain } from "@/domain/customDomain";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

const Body = z.object({ host: z.string().max(253) });

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER" });
  if (denied(ctx)) return ctx;
  return NextResponse.json(await getDomain(ctx.store.id));
}

/** Grava ou troca o dominio proprio (plano precisa permitir); fica nao verificado ate POST domain/verify. */
export async function PATCH(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER", write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, Body);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await setDomain(ctx.store.id, body.data.host));
  } catch (e) {
    return domainError(e);
  }
}
