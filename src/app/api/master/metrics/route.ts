import { NextResponse } from "next/server";
import { computePlatformMetrics } from "@/domain/platformMetrics";
import { prisma } from "@/lib/db";
import { denyUnlessMaster } from "@/lib/master-api";

export async function GET(req: Request) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const stores = await prisma.store.findMany({ select: { id: true, status: true, createdAt: true, plan: { select: { name: true, priceCents: true } } } });
  return NextResponse.json(computePlatformMetrics(stores, new Date()));
}
