"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "./api";
import { ImagesField, type Img } from "./images-field";
import { VariantRows, rowToVariant, type Row } from "./variant-rows";

export type ProductData = {
  id: string; name: string; description: string; categoryId: string | null; active: boolean;
  weightGrams: number; heightCm: number; widthCm: number; lengthCm: number; images: Img[];
};

/**
 * Dados do produto + imagens. Sem `product`: cria (com as variacoes geradas aqui) e vai para a edicao.
 * Com `product`: PATCH dos dados e do conjunto de imagens; variacoes ficam no VariantEditor. readOnly = loja suspensa.
 */
export function ProductForm(p: { categories: { id: string; name: string }[]; product?: ProductData; variantColors?: string[]; readOnly: boolean }) {
  const router = useRouter();
  const [images, setImages] = useState<Img[]>(p.product?.images.map(({ url, color }) => ({ url, color })) ?? []);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState(p.product?.name ?? "");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const colors = p.product ? (p.variantColors ?? []) : [...new Set(rows.map((r) => r.color))];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = (k: string) => Number(fd.get(k));
    const body = {
      name, description: String(fd.get("description") ?? ""), categoryId: String(fd.get("categoryId") ?? ""), active: fd.get("active") === "on",
      weightGrams: num("weightGrams"), heightCm: num("heightCm"), widthCm: num("widthCm"), lengthCm: num("lengthCm"), images,
      ...(p.product ? {} : { variants: rows.map(rowToVariant) }),
    };
    setBusy(true);
    setError("");
    setDone("");
    const r = await api<{ id: string }>(p.product ? `/api/admin/products/${p.product.id}` : "/api/admin/products", p.product ? "PATCH" : "POST", body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (p.product) {
      setDone("Produto salvo.");
      router.refresh();
    } else router.push(`/admin/produtos/${r.data.id}`);
  }

  const d = p.product;
  const numField = (n: "weightGrams" | "heightCm" | "widthCm" | "lengthCm", label: string, max: number) => (
    <label>{label} <input type="number" name={n} min={1} max={max} step={1} required defaultValue={d ? String(d[n]) : ""} /></label>
  );
  return (
    <form onSubmit={onSubmit}>
      <fieldset disabled={p.readOnly || busy} style={{ display: "grid", gap: 8, maxWidth: 760, border: 0, padding: 0 }}>
        <label>Nome <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} /></label>
        <label>Descrição <textarea name="description" defaultValue={d?.description} maxLength={5000} rows={4} /></label>
        <label>
          Categoria{" "}
          <select name="categoryId" required defaultValue={d?.categoryId ?? ""}>
            <option value="" disabled>Escolha…</option>
            {p.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {p.categories.length === 0 && <p>Cadastre uma categoria antes em <a href="/admin/categorias">Categorias</a>.</p>}
        <label><input type="checkbox" name="active" defaultChecked={d?.active ?? true} /> Ativo (visível na loja)</label>
        <fieldset>
          <legend>Peso e dimensões da embalagem (para o frete)</legend>
          {numField("weightGrams", "Peso (g)", 30000)} {numField("heightCm", "Altura (cm)", 105)} {numField("widthCm", "Largura (cm)", 105)} {numField("lengthCm", "Comprimento (cm)", 105)}
        </fieldset>
        <fieldset>
          <legend>Imagens</legend>
          <ImagesField images={images} onChange={setImages} colors={colors} />
        </fieldset>
        {!d && (
          <fieldset>
            <legend>Variações (cor × tamanho)</legend>
            <VariantRows rows={rows} onChange={setRows} skuPrefix={name} />
          </fieldset>
        )}
        <button type="submit">{d ? "Salvar produto" : "Criar produto"}</button>
        {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
        {done && <p role="status">{done}</p>}
      </fieldset>
    </form>
  );
}
