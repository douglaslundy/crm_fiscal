import { NextResponse } from "next/server";
import { z } from "zod";
import { createStoreAsMaster, listStores } from "@/domain/masterStores";
import { prisma } from "@/lib/db";
import { parseStoreQuery } from "@/lib/master-query";
import { denyUnlessMaster, domainError, err, parseBody } from "@/lib/master-api";

export async function GET(req: Request) {
  const denied = await denyUnlessMaster(req);
  if (denied) return denied;
  const query = parseStoreQuery(new URL(req.url).searchParams);
  if (!query) return err(400, "Filtros inválidos.");
  return NextResponse.json(await listStores(query));
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
