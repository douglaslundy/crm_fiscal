"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "checkbox" | "select";
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean | null;
  required?: boolean;
  nullable?: boolean; // number vazio vira null
};

const MESSAGES: Record<string, string> = {
  SLUG_TAKEN: "Este endereço já está em uso.",
  SLUG_INVALID: "Endereço inválido ou reservado.",
  PASSWORD_REQUIRED: "Conta nova exige senha de pelo menos 8 caracteres.",
  PLAN_NOT_FOUND: "Plano inexistente ou inativo.",
  EMAIL_EXISTS: "Este e-mail acabou de ser cadastrado. Tente novamente.",
  PLAN_NAME_TAKEN: "Já existe um plano com este nome.",
  PLAN_IN_USE: "Plano em uso por lojas: desative em vez de excluir.",
  PLAN_INVALID: "Dados do plano inválidos.",
  STORE_NOT_FOUND: "Loja não encontrada.",
};

/** Formulario simples que envia JSON para uma rota /api/master e atualiza (ou redireciona). */
export function MasterForm(p: {
  url: string; method?: "POST" | "PATCH" | "DELETE"; fields?: Field[]; submit: string;
  confirm?: string; redirectTo?: string; extra?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (p.confirm && !window.confirm(p.confirm)) return;
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { ...p.extra };
    for (const f of p.fields ?? []) {
      const raw = fd.get(f.name);
      if (f.type === "checkbox") body[f.name] = raw === "on";
      else if (f.type === "number") body[f.name] = raw === "" || raw === null ? (f.nullable ? null : undefined) : Number(raw);
      else if (raw !== null) body[f.name] = String(raw);
    }
    setBusy(true);
    setError("");
    let res: Response;
    try {
      res = await fetch(p.url, { method: p.method ?? "POST", headers: { "content-type": "application/json" }, body: p.method === "DELETE" ? undefined : JSON.stringify(body) });
    } catch {
      setError("Falha de conexão. Tente novamente.");
      return;
    } finally {
      setBusy(false);
    }
    if (res.ok) return p.redirectTo ? router.push(p.redirectTo) : router.refresh();
    const json = await res.json().catch(() => ({}));
    setError(MESSAGES[json.error] ?? (res.status === 401 || res.status === 403 ? "Sem permissão." : "Não foi possível concluir. Confira os dados."));
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 6, maxWidth: 420, margin: "8px 0" }}>
      {p.fields?.map((f) => (
        <label key={f.name}>
          {f.label}{" "}
          {f.type === "select" ? (
            <select name={f.name} defaultValue={String(f.defaultValue ?? "")} required={f.required}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === "checkbox" ? (
            <input type="checkbox" name={f.name} defaultChecked={Boolean(f.defaultValue)} />
          ) : (
            <input type={f.type ?? "text"} name={f.name} defaultValue={f.defaultValue == null ? "" : String(f.defaultValue)} required={f.required} min={f.type === "number" ? 0 : undefined} />
          )}
        </label>
      ))}
      <button type="submit" disabled={busy}>{p.submit}</button>
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}
