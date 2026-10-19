"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

const MESSAGES: Record<number, string> = {
  400: "Confira os dados: CPF válido, e-mail válido e senha com pelo menos 8 caracteres.",
  403: "Esta loja não está aceitando cadastros no momento.",
  409: "Este e-mail já está cadastrado nesta loja.",
};

/** `next` ja chega validado por safeNext() na pagina (servidor). */
export function RegisterForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/register-customer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 201) {
      setBusy(false);
      return setError(MESSAGES[res.status] ?? "Não foi possível concluir o cadastro.");
    }
    const r = await signIn("customer", { email: body.email, password: body.password, redirect: false });
    if (!r?.ok || r.error) {
      setBusy(false);
      setError("Cadastro criado, mas não foi possível entrar. Faça login.");
      return router.replace(`/loja-entrar?aviso=cadastro&next=${encodeURIComponent(next)}`);
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Nome <input name="name" autoComplete="name" required />
      </label>
      <label>
        E-mail <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        CPF <input name="cpf" inputMode="numeric" required />
      </label>
      <label>
        Telefone <input name="phone" type="tel" autoComplete="tel" required />
      </label>
      <label>
        Senha <input name="password" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Enviando..." : "Criar conta"}</button>
    </form>
  );
}
