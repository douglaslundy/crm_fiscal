import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/lib/safe-next";
import { getCurrentStore } from "@/lib/tenant";

type Props = { searchParams: Promise<{ next?: string | string[]; aviso?: string | string[] }> };

export default async function LojaEntrarPage({ searchParams }: Props) {
  const store = await getCurrentStore(); // 404 fora do host de uma loja
  const sp = await searchParams;
  const next = safeNext(sp.next, "/");
  return (
    <main>
      <h1>Entrar em {store.name}</h1>
      {sp.aviso === "cadastro" && <p role="status">Cadastro criado, mas não foi possível entrar. Faça login.</p>}
      <LoginForm provider="customer" next={next} />
      <p>
        Ainda não tem conta? <Link href={`/cadastro?next=${encodeURIComponent(next)}`}>Cadastre-se</Link>
      </p>
    </main>
  );
}
