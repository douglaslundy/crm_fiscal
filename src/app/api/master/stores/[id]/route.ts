import { NextResponse } from "next/server";
import { z } from "zod";
import { updateStore } from "@/domain/masterStores";
import { prisma } from "@/lib/db";
import { denyUnlessMaster, domainError, err, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const store = await prisma.store.findUnique({
    where: { id: (await params).id },
    include: { plan: true, subscription: true, members: { include: { account: { select: { name: true, email: true } } } } },
  });
  return store ? NextResponse.json(store) : err(404, "STORE_NOT_FOUND");
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const body = await parseBody(req, z.object({ name: z.string().trim().min(2).max(60).optional() }));
  if ("res" in body) return body.res;
  try {
    await updateStore((await params).id, body.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
