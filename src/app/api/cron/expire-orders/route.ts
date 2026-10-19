import { NextResponse } from "next/server";
import { expireOrders } from "@/domain/payments";
import { denyUnlessCron } from "@/lib/cron-auth";

/** Cron a cada 5 min (vercel.json): expira Pix vencidos e pedidos nao pagos ha 60 min (ver expireOrders). */
export async function GET(req: Request) {
  return denyUnlessCron(req) ?? NextResponse.json(await expireOrders(new Date()));
}
