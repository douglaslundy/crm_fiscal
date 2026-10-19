import { NextResponse } from "next/server";
import { revokeInvite } from "@/domain/team";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError } from "@/lib/master-api";

/** OWNER cancela um convite pendente. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER", write: true });
  if (denied(ctx)) return ctx;
  try {
    await revokeInvite(ctx.store.id, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
