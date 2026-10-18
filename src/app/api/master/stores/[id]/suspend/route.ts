import { NextResponse } from "next/server";
import { suspendStore } from "@/domain/masterStores";
import { denyUnlessMaster, domainError } from "@/lib/master-api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  try {
    await suspendStore((await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
