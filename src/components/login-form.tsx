"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

/** `next` ja chega validado por safeNext() na pagina (servidor). */
export function LoginForm({ provider, next }: { provider: "account" | "customer"; next: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const r = await signIn(provider, { email: f.get("email"), password: f.get("password"), redirect: false });
    setBusy(false);
    if (r?.ok && !r.error) {
      router.replace(next);
      router.refresh();
    } else setError(r?.error === "MUITAS_TENTATIVAS" ? "Muitas tentativas. Aguarde alguns minutos." : "E-mail ou senha inválidos.");
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        E-mail <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Senha <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
      <Link href="/esqueci-senha">Esqueci minha senha</Link>
    </form>
  );
}
