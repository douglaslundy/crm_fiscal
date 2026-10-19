"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatBRL } from "@/domain/money";
import { api, fromCents, toCents, type ApiResult } from "./api";
import { VariantRows, rowToVariant, type Row } from "./variant-rows";

type Variant = { id: string; color: string; size: string; sku: string; priceCents: number; stock: number; active: boolean };

/** Variacoes salvas (editar, ativar/desativar, excluir) + gerador para adicionar novas. */
export function VariantEditor({ productId, variants, productName, readOnly }: { productId: string; variants: Variant[]; productName: string; readOnly: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const base = `/api/admin/products/${productId}/variants`;

  // Em sequencia; para no primeiro erro e mostra a mensagem.
  async function run(calls: (() => Promise<ApiResult>)[]) {
    setBusy(true);
    setError("");
    for (const call of calls) {
      const r = await call();
      if (!r.ok) {
        setError(r.error);
        break;
      }
    }
    setBusy(false);
    router.refresh();
  }
  const addAll = () => run(rows.map((r) => async () => {
    const res = await api(base, "POST", rowToVariant(r));
    if (res.ok) setRows((cur) => cur.filter((x) => x !== r));
    return res;
  }));
  const save = (v: Variant, form: HTMLFormElement) => {
    const fd = new FormData(form);
    return run([() => api(`${base}/${v.id}`, "PATCH", { sku: String(fd.get("sku")), priceCents: toCents(String(fd.get("price"))), stock: Number(fd.get("stock")) })]);
  };
  const remove = (v: Variant) => {
    if (window.confirm(`Excluir a variação ${v.color} / ${v.size}? Se ela tiver pedidos, será apenas desativada.`)) void run([() => api(`${base}/${v.id}`, "DELETE")]);
  };

  return (
    <fieldset disabled={readOnly || busy} style={{ border: 0, padding: 0 }}>
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
      {variants.length === 0 && <p>Nenhuma variação ainda.</p>}
      {variants.map((v) => (
        <form key={v.id} onSubmit={(e) => { e.preventDefault(); void save(v, e.currentTarget); }} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "4px 0", opacity: v.active ? 1 : 0.6 }}>
          <strong>{v.color} / {v.size}</strong>
          <label>SKU <input name="sku" defaultValue={v.sku} required /></label>
          <label>Preço (R$) <input name="price" defaultValue={fromCents(v.priceCents)} inputMode="decimal" size={8} title={formatBRL(v.priceCents)} /></label>
          <label>Estoque <input name="stock" type="number" min={0} defaultValue={v.stock} style={{ width: 80 }} /></label>
          <button type="submit">Salvar</button>
          <label>
            <input type="checkbox" checked={v.active} onChange={(e) => void run([() => api(`${base}/${v.id}`, "PATCH", { active: e.target.checked })])} /> Ativa
          </label>
          <button type="button" onClick={() => remove(v)}>Excluir</button>
        </form>
      ))}
      <h3>Adicionar variações</h3>
      <VariantRows rows={rows} onChange={setRows} skuPrefix={productName} />
      {rows.length > 0 && <button type="button" onClick={() => void addAll()}>Salvar novas variações</button>}
    </fieldset>
  );
}
