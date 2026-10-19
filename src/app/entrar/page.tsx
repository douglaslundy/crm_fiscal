import { LoginForm } from "@/components/login-form";
import { safeNext } from "@/lib/safe-next";

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function EntrarPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <main>
      <h1>Entrar na plataforma</h1>
      <LoginForm provider="account" next={safeNext(next, "/")} />
    </main>
  );
}
