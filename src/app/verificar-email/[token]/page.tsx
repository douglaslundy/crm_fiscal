import { headers } from "next/headers";
import Link from "next/link";
import { STORE_HOST_HEADER } from "@/lib/host";
import { ResetTokenError, verifyEmail } from "@/domain/passwordReset";

export const metadata = { title: "Confirmar e-mail" };
export const dynamic = "force-dynamic";

export default async function VerificarEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const isStore = !!(await headers()).get(STORE_HOST_HEADER);
  let ok = true;
  try {
    await verifyEmail(token);
  } catch (e) {
    if (!(e instanceof ResetTokenError)) throw e;
    ok = false;
  }
  return (
    <main className="narrow">
      <h1>{ok ? "E-mail confirmado" : "Link inválido ou vencido"}</h1>
      <p>{ok ? "Obrigado! Seu e-mail foi confirmado." : "Este link já foi usado ou expirou."}</p>
      <Link href={isStore ? "/" : "/entrar"}>{isStore ? "Voltar à loja" : "Entrar"}</Link>
    </main>
  );
}
