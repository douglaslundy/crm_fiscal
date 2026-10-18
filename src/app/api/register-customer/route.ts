import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { isValidCpf, onlyDigits } from "@/domain/cpf";
import { dbForStore } from "@/lib/db-store";
import { STORE_HOST_HEADER, platformDomain } from "@/lib/host";
import { resolveStoreByHost } from "@/lib/tenant";
import { isStoreBlocked } from "@/domain/subscription";

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  cpf: z.string().refine(isValidCpf, "CPF inválido").transform(onlyDigits),
  phone: z.string().trim().min(8).max(30),
  password: z.string().min(8).max(72), // bcrypt ignora alem de 72 bytes
});

const err = (status: number, error: string, extra?: object) => NextResponse.json({ error, ...extra }, { status });

/** Cadastro de comprador na loja do host (header do middleware, nunca do corpo). */
export async function POST(req: Request) {
  const host = req.headers.get(STORE_HOST_HEADER);
  const store = host ? await resolveStoreByHost(host, platformDomain()) : null;
  if (!store) return err(404, "Loja não encontrada.");
  if (isStoreBlocked(store)) return err(403, "Esta loja não está aceitando cadastros.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Dados inválidos.", { fields: z.flattenError(parsed.error).fieldErrors });

  const { password, ...data } = parsed.data;
  try {
    const c = await dbForStore(store.id).customer.create({
      data: { ...data, storeId: store.id, passwordHash: await bcrypt.hash(password, 10) },
      select: { id: true, name: true, email: true },
    });
    return NextResponse.json(c, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return err(409, "E-mail já cadastrado nesta loja.");
    throw e;
  }
}
