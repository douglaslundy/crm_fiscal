import { Prisma, type Category } from "@prisma/client";
import { dbForStore, type StoreDb } from "@/lib/db-store";
import { slugify } from "./slug";
import { SlugInvalidError, SlugTakenError } from "./stores";

export class CategoryValidationError extends Error {}
export class CategoryNotFoundError extends Error {}
export class ParentNotFoundError extends Error {}
export class ParentCycleError extends Error {}
export class MaxDepthError extends Error {}
export class CategoryInUseError extends Error {}

export const MAX_DEPTH = 3;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/;

export type CategoryInput = { name: string; slug?: string; parentId?: string | null };

const code = (e: unknown) => (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined);

function cleanName(name: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 60) throw new CategoryValidationError("Nome deve ter de 1 a 60 caracteres.");
  return n;
}
function cleanSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) throw new SlugInvalidError("Endereço inválido.");
  return slug;
}

type Node = { id: string; parentId: string | null };
type Tx = Parameters<Parameters<StoreDb["$transaction"]>[0]>[0];
const byId = (all: Node[]) => new Map(all.map((c) => [c.id, c]));

/** Nivel do no na arvore (raiz = 1). Limitado: dado ja corrompido (ciclo) estoura MAX_DEPTH em vez de girar. */
function levelOf(map: Map<string, Node>, id: string): number {
  let n = 0;
  for (let cur = map.get(id); cur && n <= MAX_DEPTH; cur = cur.parentId ? map.get(cur.parentId) : undefined) n++;
  return n;
}
/** Altura da subarvore (o proprio no = 1). Ciclo pre-existente: ParentCycleError, nunca recursao infinita. */
function heightOf(all: Node[], id: string, seen: Set<string> = new Set()): number {
  if (seen.has(id)) throw new ParentCycleError("A árvore de categorias está inconsistente (ciclo).");
  seen.add(id);
  const h = 1 + Math.max(0, ...all.filter((c) => c.parentId === id).map((k) => heightOf(all, k.id, seen)));
  seen.delete(id);
  return h;
}

// Concorrencia: leitura da arvore + checagens + escrita rodam dentro de $transaction({ lockStore }), que trava a linha
// da Store; duas edicoes de pai da mesma loja nunca se intercalam (a FK composta nao impede ciclos).
async function checkParent(tx: Tx, selfId: string | null, parentId: string): Promise<void> {
  const all = await tx.category.findMany({ select: { id: true, parentId: true } });
  const map = byId(all);
  if (!map.has(parentId)) throw new ParentNotFoundError("Categoria pai não encontrada.");
  let selfHeight = 1;
  if (selfId) {
    for (let cur: Node | undefined = map.get(parentId), n = 0; cur && n <= all.length; cur = cur.parentId ? map.get(cur.parentId) : undefined, n++) {
      if (cur.id === selfId) throw new ParentCycleError("A categoria não pode ficar dentro dela mesma.");
    }
    selfHeight = heightOf(all, selfId);
  }
  if (levelOf(map, parentId) + selfHeight > MAX_DEPTH) throw new MaxDepthError(`No máximo ${MAX_DEPTH} níveis.`);
}

type Row = { id: string; parentId: string | null };
/** Ordem de arvore (pai antes das filhas) + nos inalcancaveis da raiz (ciclo/dado inconsistente), que nunca somem da tela. */
export function buildTree<T extends Row>(rows: T[]): { tree: (T & { depth: number })[]; orphans: T[] } {
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number): (T & { depth: number })[] =>
    rows.filter((r) => r.parentId === parentId && !seen.has(r.id)).flatMap((r) => (seen.add(r.id), [{ ...r, depth }, ...walk(r.id, depth + 1)]));
  const tree = walk(null, 0);
  return { tree, orphans: rows.filter((r) => !seen.has(r.id)) };
}

export async function listCategories(storeId: string) {
  const rows = await dbForStore(storeId).category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, children: true } } },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products, childCount: _count.children }));
}

const taken = () => new SlugTakenError("Já existe uma categoria com este endereço.");

export async function createCategory(storeId: string, input: CategoryInput): Promise<Category> {
  const name = cleanName(input.name);
  const slug = cleanSlug(input.slug ?? slugify(name));
  try {
    return await dbForStore(storeId).$transaction(async (tx) => {
      if (input.parentId) await checkParent(tx, null, input.parentId);
      return tx.category.create({ data: { storeId, name, slug, parentId: input.parentId ?? null } });
    }, { lockStore: true });
  } catch (e) {
    if (code(e) === "P2002") throw taken();
    throw e;
  }
}

export async function updateCategory(storeId: string, id: string, input: Partial<CategoryInput>): Promise<Category> {
  const data: Prisma.CategoryUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.slug !== undefined) data.slug = cleanSlug(input.slug);
  try {
    return await dbForStore(storeId).$transaction(async (tx) => {
      if (!(await tx.category.findUnique({ where: { id }, select: { id: true } }))) throw new CategoryNotFoundError("Categoria não encontrada.");
      if (input.parentId !== undefined) {
        if (input.parentId) await checkParent(tx, id, input.parentId);
        data.parentId = input.parentId;
      }
      return tx.category.update({ where: { id }, data });
    }, { lockStore: true });
  } catch (e) {
    if (code(e) === "P2002") throw taken();
    if (code(e) === "P2025") throw new CategoryNotFoundError("Categoria não encontrada.");
    throw e;
  }
}

export async function deleteCategory(storeId: string, id: string): Promise<void> {
  const db = dbForStore(storeId);
  if (!(await db.category.findUnique({ where: { id }, select: { id: true } }))) throw new CategoryNotFoundError("Categoria não encontrada.");
  const [kids, products] = await Promise.all([db.category.count({ where: { parentId: id } }), db.product.count({ where: { categoryId: id } })]);
  if (kids || products) throw new CategoryInUseError("Categoria com produtos ou subcategorias.");
  try {
    await db.category.delete({ where: { id } });
  } catch (e) {
    if (code(e) === "P2003") throw new CategoryInUseError("Categoria com produtos ou subcategorias.");
    if (code(e) === "P2025") throw new CategoryNotFoundError("Categoria não encontrada.");
    throw e;
  }
}
