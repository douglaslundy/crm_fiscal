import { NextResponse } from "next/server";
import { listSubscribers } from "@/domain/subscribers";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req);
  if (denied(ctx)) return ctx;
  return NextResponse.json(await listSubscribers(ctx.store.id));
}
