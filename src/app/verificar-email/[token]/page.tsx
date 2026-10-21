import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { STORE_HOST_HEADER } from "@/lib/host";
import { ResetTokenError, verifyEmail } from "@/domain/passwordReset";

export const metadata = { title: "Confirmar e-mail" };
export const dynamic = "force-dynamic";

// A confirmacao so acontece no POST: scanners de e-mail abrem o link (GET) e nao devem consumir o token.
async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  let ok = true;
  try {
    await verifyEmail(token);
  } catch (e) {
    if (!(e instanceof ResetTokenError)) throw e;
    ok = false;
  }
  redirect(`/verificar-email/${encodeURIComponent(token)}?r=${ok ? "ok" : "erro"}`);
}

export default async function VerificarEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token } = await params;
  const { r } = await searchParams;
  const isStore = !!(await headers()).get(STORE_HOST_HEADER);
  const back = <Link href={isStore ? "/" : "/entrar"}>{isStore ? "Voltar à loja" : "Entrar"}</Link>;

  if (r === "ok") {
    return (
      <main className="narrow">
        <h1>E-mail confirmado</h1>
        <p>Obrigado! Seu e-mail foi confirmado.</p>
        {back}
      </main>
    );
  }
  if (r === "erro") {
    return (
      <main className="narrow">
        <h1>Link inválido ou vencido</h1>
        <p>Este link já foi usado ou expirou.</p>
        {back}
      </main>
    );
  }
  return (
    <main className="narrow">
      <h1>Confirmar e-mail</h1>
      <p>Clique no botão para confirmar seu e-mail.</p>
      <form action={confirm}>
        <input type="hidden" name="token" value={token} />
        <button type="submit">Confirmar e-mail</button>
      </form>
    </main>
  );
}
