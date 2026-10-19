import { NextResponse } from "next/server";
import { evaluateStoreLifecycle } from "@/domain/subscription";
import { denyUnlessCron } from "@/lib/cron-auth";

/** Cron horario (vercel.json). Exige `Authorization: Bearer ${CRON_SECRET}`; sem CRON_SECRET recusa tudo. */
export async function GET(req: Request) {
  return denyUnlessCron(req) ?? NextResponse.json(await evaluateStoreLifecycle(new Date()));
}
