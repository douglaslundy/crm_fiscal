import { Prisma, type Category } from "@prisma/client";
import { dbForStore } from "@/lib/db-store";
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
const byId = (all: Node[]) => new Map(all.map((c) => [c.id, c]));

/** Nivel do no na arvore (raiz = 1). */
function levelOf(map: Map<string, Node>, id: string): number {
  let n = 0;
  for (let cur = map.get(id); cur && n <= MAX_DEPTH + 50; cur = cur.parentId ? map.get(cur.parentId) : undefined) n++;
  return n;
}
/** Altura da subarvore (o proprio no = 1). */
function heightOf(all: Node[], id: string): number {
  const kids = all.filter((c) => c.parentId === id);
  return 1 + Math.max(0, ...kids.map((k) => heightOf(all, k.id)));
}

// shortcut: leitura da arvore + escrita sem trava; duas edicoes simultaneas de pai podem furar a checagem de
// ciclo/profundidade. Aceitavel no painel de poucos editores; trocar por transacao SERIALIZABLE se virar problema.
async function checkParent(storeId: string, selfId: string | null, parentId: string, selfHeight = 1): Promise<void> {
  const all = await dbForStore(storeId).category.findMany({ select: { id: true, parentId: true } });
  const map = byId(all);
  if (!map.has(parentId)) throw new ParentNotFoundError("Categoria pai não encontrada.");
  if (selfId) {
    for (let cur: Node | undefined = map.get(parentId), n = 0; cur && n <= all.length; cur = cur.parentId ? map.get(cur.parentId) : undefined, n++) {
      if (cur.id === selfId) throw new ParentCycleError("A categoria não pode ficar dentro dela mesma.");
    }
    selfHeight = heightOf(all, selfId);
  }
  if (levelOf(map, parentId) + selfHeight > MAX_DEPTH) throw new MaxDepthError(`No máximo ${MAX_DEPTH} níveis.`);
}

export async function listCategories(storeId: string) {
  const rows = await dbForStore(storeId).category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, children: true } } },
  });
  return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products, childCount: _count.children }));
}

export async function createCategory(storeId: string, input: CategoryInput): Promise<Category> {
  const name = cleanName(input.name);
  const slug = cleanSlug(input.slug ?? slugify(name));
  if (input.parentId) await checkParent(storeId, null, input.parentId);
  try {
    return await dbForStore(storeId).category.create({ data: { storeId, name, slug, parentId: input.parentId ?? null } });
  } catch (e) {
    if (code(e) === "P2002") throw new SlugTakenError("Já existe uma categoria com este endereço.");
    throw e;
  }
}

export async function updateCategory(storeId: string, id: string, input: Partial<CategoryInput>): Promise<Category> {
  const db = dbForStore(storeId);
  if (!(await db.category.findUnique({ where: { id }, select: { id: true } }))) throw new CategoryNotFoundError("Categoria não encontrada.");
  const data: Prisma.CategoryUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.slug !== undefined) data.slug = cleanSlug(input.slug);
  if (input.parentId !== undefined) {
    if (input.parentId) await checkParent(storeId, id, input.parentId);
    data.parentId = input.parentId;
  }
  try {
    return await db.category.update({ where: { id }, data });
  } catch (e) {
    if (code(e) === "P2002") throw new SlugTakenError("Já existe uma categoria com este endereço.");
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
