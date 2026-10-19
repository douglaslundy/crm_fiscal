import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePlan, setPlanActive, updatePlan } from "@/domain/masterPlans";
import { PlanBody } from "@/lib/master-plan-body";
import { denyUnlessMaster, domainError, parseBody } from "@/lib/master-api";

type Ctx = { params: Promise<{ id: string }> };

/** Edita campos e/ou ativa/desativa (campo `active`). */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const body = await parseBody(req, PlanBody.partial().extend({ active: z.boolean().optional() }));
  if ("res" in body) return body.res;
  const { active, ...fields } = body.data;
  try {
    const id = (await params).id;
    let plan = Object.keys(fields).length ? await updatePlan(id, fields) : undefined;
    if (active !== undefined) plan = await setPlanActive(id, active);
    return NextResponse.json(plan ?? { ok: true });
  } catch (e) {
    return domainError(e);
  }
}

/** 409 se houver lojas no plano (desative em vez de excluir). */
export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  try {
    await deletePlan((await params).id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
