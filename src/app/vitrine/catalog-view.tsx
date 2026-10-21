import Link from "next/link";
import type { CatalogFilters, ProductCard } from "@/domain/catalog";
import { formatBRL, installments, pixPriceCents } from "@/domain/money";

export type SP = Record<string, string | string[] | undefined>;

export const toSearchParams = (sp: SP) =>
  new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => [k, x])));

export function Unavailable() {
  return (
    <main>
      <p role="status">Loja indisponível no momento.</p>
    </main>
  );
}

export function PriceInfo({ priceCents, pixPercent }: { priceCents: number; pixPercent: number }) {
  const inst = installments(priceCents);
  return (
    <div>
      <strong className="price">{formatBRL(priceCents)}</strong>
      {pixPercent > 0 && <div className="price-note">{formatBRL(pixPriceCents(priceCents, pixPercent))} no Pix ({pixPercent}% de desconto)</div>}
      {inst.count > 1 && <div className="price-note">ou {inst.count}x de {formatBRL(inst.valueCents)} sem juros</div>}
    </div>
  );
}

export function ProductGrid({ items, pixPercent }: { items: ProductCard[]; pixPercent: number }) {
  if (!items.length) return <p>Nenhum produto encontrado.</p>;
  return (
    <ul className="product-grid">
      {items.map((p) => (
        <li key={p.id} className="product-card">
          <Link href={`/p/${p.slug}`} className="thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.imageUrl && <img src={p.imageUrl} alt={p.name} loading="lazy" />}
          </Link>
          <div className="info">
            <Link href={`/p/${p.slug}`} className="name">{p.name}</Link>
            <div>
              {p.soldOut && <span className="badge dark">Esgotado</span>}
              {p.lastUnit && <span className="badge warn">Última peça</span>}
            </div>
            <div className="price-note">A partir de</div>
            <PriceInfo priceCents={p.minPriceCents} pixPercent={pixPercent} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Pagination({ basePath, sp, page, total, pageSize }: { basePath: string; sp: URLSearchParams; page: number; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams(sp);
    q.set("page", String(p));
    return `${basePath}?${q}`;
  };
  return (
    <nav aria-label="Páginas" className="pagination">
      {page > 1 && <Link href={href(page - 1)}>Anterior</Link>}
      <span>Página {Math.min(page, pages)} de {pages}</span>
      {page < pages && <Link href={href(page + 1)}>Próxima</Link>}
    </nav>
  );
}

const PRICE_STEPS = [5000, 10000, 20000, 50000];

/** Formulario GET: tamanhos/cores repetiveis, faixa de preco em centavos (valores fixos). */
export function Filters({ action, f, options }: { action: string; f: CatalogFilters; options: { sizes: string[]; colors: string[] } }) {
  const lower = (vs: string[]) => new Set(vs.map((v) => v.toLowerCase()));
  const sizes = lower(f.sizes);
  const colors = lower(f.colors);
  return (
    <form method="get" action={action} className="filters">
      {f.q && <input type="hidden" name="q" value={f.q} />}
      {options.sizes.length > 0 && (
        <fieldset>
          <legend>Tamanho</legend>
          {options.sizes.map((s) => (
            <label key={s} style={{ marginRight: 8 }}><input type="checkbox" name="size" value={s} defaultChecked={sizes.has(s.toLowerCase())} /> {s}</label>
          ))}
        </fieldset>
      )}
      {options.colors.length > 0 && (
        <fieldset>
          <legend>Cor</legend>
          {options.colors.map((c) => (
            <label key={c} style={{ marginRight: 8 }}><input type="checkbox" name="color" value={c} defaultChecked={colors.has(c.toLowerCase())} /> {c}</label>
          ))}
        </fieldset>
      )}
      <label>
        Preço mínimo{" "}
        <select name="min" defaultValue={f.minCents ?? ""}>
          <option value="">Qualquer</option>
          {PRICE_STEPS.map((c) => <option key={c} value={c}>{formatBRL(c)}</option>)}
        </select>
      </label>
      <label>
        Preço máximo{" "}
        <select name="max" defaultValue={f.maxCents ?? ""}>
          <option value="">Qualquer</option>
          {PRICE_STEPS.map((c) => <option key={c} value={c}>{formatBRL(c)}</option>)}
        </select>
      </label>
      <button type="submit">Filtrar</button>
    </form>
  );
}
