"use client";

import { useState, type FormEvent } from "react";

export type Address = { id: string; cep: string; street: string; number: string; complement: string | null; district: string; city: string; state: string };

export const addressLabel = (a: Address) =>
  `${a.street}, ${a.number}${a.complement ? ` (${a.complement})` : ""} — ${a.district}, ${a.city}/${a.state} — CEP ${a.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}`;

const FIELDS: [name: keyof Omit<Address, "id">, label: string, max: number, required: boolean][] = [
  ["cep", "CEP", 9, true], ["street", "Rua", 120, true], ["number", "Número", 20, true], ["complement", "Complemento", 120, false],
  ["district", "Bairro", 80, true], ["city", "Cidade", 80, true], ["state", "UF", 2, true],
];

/** Novo endereco do cliente logado (POST /api/checkout/address). */
export function AddressForm({ onCreated }: { onCreated: (a: Address) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/checkout/address", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      if (r.ok) { form.reset(); onCreated(await r.json()); }
      else setError(r.status === 400 ? "Confira os dados do endereço (CEP e UF com 2 letras)." : "Não foi possível salvar o endereço.");
    } catch {
      setError("Não foi possível salvar o endereço.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      {FIELDS.map(([name, label, max, required]) => (
        <label key={name} style={{ display: "grid" }}>{label}
          <input name={name} maxLength={max} required={required} />
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar endereço"}</button>
    </form>
  );
}
