import { NextResponse } from "next/server";
import { z } from "zod";
import { inviteStaff, listTeam } from "@/domain/team";
import { platformDomain } from "@/lib/host";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

const Body = z.object({ email: z.string().min(3).max(320) });

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER" });
  if (denied(ctx)) return ctx;
  return NextResponse.json(await listTeam(ctx.store.id));
}

/** So o OWNER convida. Conta existente entra direto (devolve a equipe); e-mail novo gera link de convite (inviteUrl, mostrado uma unica vez). */
export async function POST(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER", write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, Body);
  if ("res" in body) return body.res;
  try {
    const r = await inviteStaff(ctx.store.id, body.data.email);
    if (r.status === "INVITED") {
      const domain = platformDomain();
      return NextResponse.json({ inviteUrl: `${domain === "localhost" ? "http" : "https"}://${domain}/convite/${r.token}` }, { status: 201 });
    }
    return NextResponse.json(await listTeam(ctx.store.id), { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
