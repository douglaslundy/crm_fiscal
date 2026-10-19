import { NextResponse } from "next/server";
import { z } from "zod";
import { changeStorePlan } from "@/domain/masterStores";
import { denyUnlessMaster, domainError, parseBody } from "@/lib/master-api";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const body = await parseBody(req, z.object({ planId: z.string().min(1) }));
  if ("res" in body) return body.res;
  try {
    await changeStorePlan((await params).id, body.data.planId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
