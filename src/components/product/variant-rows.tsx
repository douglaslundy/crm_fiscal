"use client";

import { useState } from "react";
import { expandVariants } from "@/domain/variants";
import { slugify } from "@/domain/slug";
import { fromCents, toCents } from "./api";

export type Row = { color: string; size: string; sku: string; price: string; stock: string; active: boolean };
export const rowToVariant = (r: Row) => ({ color: r.color, size: r.size, sku: r.sku, priceCents: toCents(r.price), stock: Number(r.stock), active: r.active });

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Gerador cor x tamanho + tabela editavel (preco, estoque, SKU, ativa) das variacoes ainda nao salvas. */
export function VariantRows({ rows, onChange, skuPrefix }: { rows: Row[]; onChange: (rows: Row[]) => void; skuPrefix: string }) {
  const [colors, setColors] = useState("");
  const [sizes, setSizes] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [error, setError] = useState("");

  function generate() {
    setError("");
    try {
      const fresh = expandVariants(split(colors), split(sizes), { priceCents: toCents(price), stock: Number(stock) }, slugify(skuPrefix));
      const key = (r: { color: string; size: string }) => `${r.color.toLowerCase()}|${r.size.toLowerCase()}`;
      const have = new Set(rows.map(key));
      onChange([...rows, ...fresh.filter((v) => !have.has(key(v))).map((v) => ({ ...v, price: fromCents(v.priceCents), stock: String(v.stock), active: true }))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confira os dados.");
    }
  }
  const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label>Cores (separadas por vírgula) <input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="Preto, Branco" /></label>
        <label>Tamanhos (separados por vírgula) <input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="P, M, G" /></label>
        <label>Preço (R$) <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="59,90" /></label>
        <label>Estoque <input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></label>
        <button type="button" onClick={generate}>Gerar variações</button>
      </div>
      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
      {rows.length > 0 && (
        <table>
          <thead><tr><th>Cor</th><th>Tamanho</th><th>SKU</th><th>Preço (R$)</th><th>Estoque</th><th>Ativa</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.color}|${r.size}`}>
                <td>{r.color}</td>
                <td>{r.size}</td>
                <td><input aria-label="SKU" value={r.sku} onChange={(e) => set(i, { sku: e.target.value })} /></td>
                <td><input aria-label="Preço" value={r.price} onChange={(e) => set(i, { price: e.target.value })} inputMode="decimal" size={8} /></td>
                <td><input aria-label="Estoque" type="number" min={0} value={r.stock} onChange={(e) => set(i, { stock: e.target.value })} style={{ width: 80 }} /></td>
                <td><input aria-label="Ativa" type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /></td>
                <td><button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
