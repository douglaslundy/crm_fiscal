import { NextResponse } from "next/server";
import { verifyDomain } from "@/domain/customDomain";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError } from "@/lib/master-api";

/** Consulta o CNAME do dominio gravado e atualiza `verified`. */
export async function POST(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER", write: true });
  if (denied(ctx)) return ctx;
  try {
    return NextResponse.json(await verifyDomain(ctx.store.id));
  } catch (e) {
    return domainError(e);
  }
}
