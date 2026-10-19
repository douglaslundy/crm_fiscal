import { NextResponse } from "next/server";
import { SubscriberNotFoundError, removeSubscriber } from "@/domain/subscribers";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { err } from "@/lib/master-api";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await denyUnlessStoreMember(req, { write: true });
  if (denied(ctx)) return ctx;
  try {
    await removeSubscriber(ctx.store.id, (await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SubscriberNotFoundError) return err(404, "SUBSCRIBER_NOT_FOUND");
    throw e;
  }
}
