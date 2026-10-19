import { NextResponse } from "next/server";
import { removeMember } from "@/domain/team";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

/** OWNER remove um STAFF (id = accountId); nunca o OWNER nem a si mesmo. */
export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER", write: true });
  if (denied(ctx)) return ctx;
  try {
    await removeMember(ctx.store.id, (await params).id, ctx.session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
