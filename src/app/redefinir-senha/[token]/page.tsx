import { headers } from "next/headers";
import { ResetForm } from "@/components/reset-form";
import { STORE_HOST_HEADER } from "@/lib/host";

export const metadata = { title: "Nova senha" };

export default async function RedefinirSenhaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const isStore = !!(await headers()).get(STORE_HOST_HEADER);
  return (
    <main className="narrow">
      <h1>Criar nova senha</h1>
      <ResetForm token={token} loginHref={isStore ? "/loja-entrar" : "/entrar"} />
    </main>
  );
}
