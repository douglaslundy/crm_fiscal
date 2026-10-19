"use client";

import { useState } from "react";
import { AddressForm, addressLabel, type Address } from "../../checkout/address-form";

/** Lista, edita, apaga e cria enderecos (rotas /api/checkout/address). */
export function AddressesView({ initial }: { initial: Address[] }) {
  const [list, setList] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    if (!confirm("Apagar este endereço?")) return;
    setError(null);
    const r = await fetch(`/api/checkout/address/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setList((l) => l.filter((a) => a.id !== id));
    else setError("Não foi possível apagar o endereço.");
  }

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {list.map((a) => (
          <li key={a.id}>
            {editing === a.id ? (
              <AddressForm address={a} onCreated={(n) => { setList((l) => l.map((x) => (x.id === n.id ? n : x))); setEditing(null); }} />
            ) : (
              <>
                {addressLabel(a)} <button onClick={() => setEditing(a.id)}>Editar</button> <button onClick={() => remove(a.id)}>Apagar</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <h2>Novo endereço</h2>
      <AddressForm onCreated={(a) => setList((l) => [...l, a])} />
    </>
  );
}
