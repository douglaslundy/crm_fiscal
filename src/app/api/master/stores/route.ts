import { NextResponse } from "next/server";
import { z } from "zod";
import { StoreStatus } from "@prisma/client";
import { createStoreAsMaster, listStores } from "@/domain/masterStores";
import { prisma } from "@/lib/db";
import { denyUnlessMaster, domainError, parseBody } from "@/lib/master-api";

export async function GET(req: Request) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const status = StoreStatus[sp.get("status") as keyof typeof StoreStatus];
  return NextResponse.json(await listStores({ status, planId: sp.get("planId") || undefined, q: sp.get("q") || undefined, page: Number(sp.get("page")) || 1 }));
}

const Body = z.object({
  ownerName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().max(72).optional().transform((s) => s || undefined), // obrigatoria so para conta nova (o dominio valida)
  storeName: z.string().trim().min(2).max(60),
  slug: z.string().trim().optional().transform((s) => s || undefined),
  planId: z.string().min(1),
  startMode: z.enum(["trial", "active"]),
});

export async function POST(req: Request) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const body = await parseBody(req, Body);
  if ("res" in body) return body.res;
  try {
    const { store } = await createStoreAsMaster(body.data, { db: prisma });
    return NextResponse.json({ id: store.id, slug: store.slug }, { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
