import { NextResponse } from "next/server";
import { z } from "zod";
import { CREDENTIAL_FIELDS, getCredentialStatus, setCredentials } from "@/domain/storeSettings";
import { denied, denyUnlessStoreMember } from "@/lib/admin-api";
import { domainError, parseBody } from "@/lib/master-api";

// Respostas so trazem { configured, last4 } por campo; o segredo nunca volta. Escrita so do OWNER.
const secret = z.string().max(1000).optional();
const Body = z.object({
  mpAccessToken: secret, mpPublicKey: secret, mpWebhookSecret: secret, melhorEnvioToken: secret,
  clear: z.array(z.enum(CREDENTIAL_FIELDS)).optional(),
});

export async function GET(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER" });
  if (denied(ctx)) return ctx;
  return NextResponse.json(await getCredentialStatus(ctx.store.id));
}

export async function PATCH(req: Request) {
  const ctx = await denyUnlessStoreMember(req, { role: "OWNER", write: true });
  if (denied(ctx)) return ctx;
  const body = await parseBody(req, Body);
  if ("res" in body) return body.res;
  try {
    const { clear, ...values } = body.data;
    await setCredentials(ctx.store.id, values, clear);
    return NextResponse.json(await getCredentialStatus(ctx.store.id));
  } catch (e) {
    return domainError(e);
  }
}
