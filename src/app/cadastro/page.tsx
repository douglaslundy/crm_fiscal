import Link from "next/link";
import { RegisterForm } from "@/components/register-form";
import { safeNext } from "@/lib/safe-next";
import { getCurrentStore } from "@/lib/tenant";

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function CadastroPage({ searchParams }: Props) {
  const store = await getCurrentStore(); // 404 fora do host de uma loja
  const next = safeNext((await searchParams).next, "/");
  return (
    <main className="narrow">
      <h1>Criar conta em {store.name}</h1>
      <RegisterForm next={next} />
      <p>
        Já tem conta? <Link href={`/loja-entrar?next=${encodeURIComponent(next)}`}>Entrar</Link>
      </p>
    </main>
  );
}
