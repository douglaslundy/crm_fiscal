"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

export function ResetForm({ token, loginHref }: { token: string; loginHref: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid" | "error">("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const res = await fetch("/api/password/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password: new FormData(e.currentTarget).get("password") }),
    }).catch(() => null);
    setState(res?.ok ? "done" : res?.status === 400 ? "invalid" : "error");
  }

  if (state === "done") return <p role="status">Senha alterada. <Link href={loginHref}>Entrar</Link></p>;
  return (
    <form onSubmit={onSubmit}>
      <label>
        Nova senha (mínimo 8 caracteres) <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
      </label>
      {state === "invalid" && <p role="alert">Link inválido ou vencido. Peça um novo.</p>}
      {state === "error" && <p role="alert">Não foi possível alterar a senha. Tente de novo.</p>}
      <button type="submit" disabled={state === "busy"}>{state === "busy" ? "Salvando..." : "Salvar nova senha"}</button>
    </form>
  );
}
