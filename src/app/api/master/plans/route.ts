import { NextResponse } from "next/server";
import { createPlan } from "@/domain/masterPlans";
import { prisma } from "@/lib/db";
import { PlanBody } from "@/lib/master-plan-body";
import { denyUnlessMaster, domainError, parseBody } from "@/lib/master-api";

export async function GET(req: Request) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  return NextResponse.json(await prisma.plan.findMany({ orderBy: { priceCents: "asc" }, include: { _count: { select: { stores: true } } } }));
}

export async function POST(req: Request) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const body = await parseBody(req, PlanBody);
  if ("res" in body) return body.res;
  try {
    return NextResponse.json(await createPlan(body.data), { status: 201 });
  } catch (e) {
    return domainError(e);
  }
}
