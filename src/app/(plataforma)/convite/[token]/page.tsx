import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AcceptInviteForm } from "@/components/accept-invite-form";
import { peekInvite } from "@/domain/team";
import { STORE_HOST_HEADER } from "@/lib/host";

export const dynamic = "force-dynamic";

export default async function ConvitePage({ params }: { params: Promise<{ token: string }> }) {
  if ((await headers()).get(STORE_HOST_HEADER)) notFound(); // so no host da plataforma
  const { token } = await params;
  const inv = await peekInvite(token);
  if (!inv) return <main><h1>Convite inválido</h1><p>O link expirou ou já foi usado. Peça um novo convite ao dono da loja.</p></main>;
  return (
    <main>
      <h1>Convite para a equipe</h1>
      <p>Você foi convidado para a loja <strong>{inv.storeName}</strong> com o e-mail {inv.email}. Crie sua senha para entrar.</p>
      <AcceptInviteForm token={token} />
    </main>
  );
}
