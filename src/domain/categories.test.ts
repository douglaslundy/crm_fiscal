import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dbForStore } from "@/lib/db-store";
import { SlugInvalidError, SlugTakenError } from "./stores";
import {
  CategoryInUseError, CategoryNotFoundError, CategoryValidationError, MaxDepthError, ParentCycleError, ParentNotFoundError,
  buildTree, createCategory, deleteCategory, listCategories, updateCategory,
} from "./categories";

let tag: string;
let planId: string;
let a: string;
let b: string;
const storeIds: string[] = [];
const planIds: string[] = [];

beforeEach(async () => {
  tag = Math.random().toString(36).slice(2, 8);
  planId = (await prisma.plan.create({ data: { name: `T9c-${tag}`, priceCents: 1, staffLimit: 1, customDomain: false, advancedMetrics: false, csvExport: false } })).id;
  planIds.push(planId);
  const mk = async (k: string) => {
    const s = await prisma.store.create({ data: { slug: `t9c-${k}-${tag}`, name: k, planId } });
    storeIds.push(s.id);
    return s.id;
  };
  a = await mk("a");
  b = await mk("b");
});
afterEach(async () => {
  await prisma.store.deleteMany({ where: { id: { in: storeIds.splice(0) } } }); // cascata leva categorias e produtos
  await prisma.plan.deleteMany({ where: { id: { in: planIds.splice(0) } } });
});
afterAll(() => prisma.$disconnect());

const mkProduct = (storeId: string, categoryId: string) =>
  dbForStore(storeId).product.create({ data: { storeId, slug: `p-${tag}`, name: "P", categoryId, weightGrams: 1, heightCm: 1, widthCm: 1, lengthCm: 1 } });

describe("createCategory", () => {
  it("gera slug do nome e apara o nome", async () => {
    const c = await createCategory(a, { name: "  Calças Jeans  " });
    expect(c).toMatchObject({ name: "Calças Jeans", slug: "calcas-jeans", parentId: null, storeId: a });
  });
  it("aceita slug explicito valido e recusa invalido (400, nao 500)", async () => {
    expect((await createCategory(a, { name: "X", slug: "meu-slug" })).slug).toBe("meu-slug");
    for (const slug of ["Maiusc", "-ab", "ab-", "a b", "a_b", "x".repeat(61)]) {
      await expect(createCategory(a, { name: "Y", slug })).rejects.toBeInstanceOf(SlugInvalidError);
    }
    await expect(createCategory(a, { name: "!!!" })).rejects.toBeInstanceOf(SlugInvalidError); // slug vazio
  });
  it("valida o nome: vazio, so espacos e mais de 60", async () => {
    for (const name of ["", "   ", "n".repeat(61)]) await expect(createCategory(a, { name })).rejects.toBeInstanceOf(CategoryValidationError);
    expect((await createCategory(a, { name: "n".repeat(60) })).name).toHaveLength(60);
  });
  it("slug unico por loja; o mesmo slug em outra loja pode", async () => {
    await createCategory(a, { name: "Vestidos" });
    await expect(createCategory(a, { name: "Vestidos" })).rejects.toBeInstanceOf(SlugTakenError);
    await expect(createCategory(a, { name: "Outro", slug: "vestidos" })).rejects.toBeInstanceOf(SlugTakenError);
    expect((await createCategory(b, { name: "Vestidos" })).slug).toBe("vestidos");
  });
  it("pai de outra loja ou inexistente: PARENT_NOT_FOUND", async () => {
    const other = await createCategory(b, { name: "Alheia" });
    await expect(createCategory(a, { name: "F", parentId: other.id })).rejects.toBeInstanceOf(ParentNotFoundError);
    await expect(createCategory(a, { name: "F", parentId: "nao-existe" })).rejects.toBeInstanceOf(ParentNotFoundError);
  });
  it("limite de 3 niveis", async () => {
    const l1 = await createCategory(a, { name: "L1" });
    const l2 = await createCategory(a, { name: "L2", parentId: l1.id });
    const l3 = await createCategory(a, { name: "L3", parentId: l2.id });
    await expect(createCategory(a, { name: "L4", parentId: l3.id })).rejects.toBeInstanceOf(MaxDepthError);
  });
});

describe("updateCategory", () => {
  it("renomeia sem mexer no slug; troca slug; mantem o proprio slug sem conflito", async () => {
    const c = await createCategory(a, { name: "Antigo" });
    expect(await updateCategory(a, c.id, { name: "Novo" })).toMatchObject({ name: "Novo", slug: "antigo" });
    expect((await updateCategory(a, c.id, { slug: "novo-slug" })).slug).toBe("novo-slug");
    expect((await updateCategory(a, c.id, { slug: "novo-slug", name: "Z" })).name).toBe("Z");
  });
  it("slug ja usado por outra categoria da loja: SlugTaken; slug invalido: SlugInvalid", async () => {
    await createCategory(a, { name: "Um" });
    const c2 = await createCategory(a, { name: "Dois" });
    await expect(updateCategory(a, c2.id, { slug: "um" })).rejects.toBeInstanceOf(SlugTakenError);
    await expect(updateCategory(a, c2.id, { slug: "Bad Slug" })).rejects.toBeInstanceOf(SlugInvalidError);
    await expect(updateCategory(a, c2.id, { name: "" })).rejects.toBeInstanceOf(CategoryValidationError);
  });
  it("move para outro pai e volta para a raiz", async () => {
    const p = await createCategory(a, { name: "Pai" });
    const c = await createCategory(a, { name: "Filha" });
    expect((await updateCategory(a, c.id, { parentId: p.id })).parentId).toBe(p.id);
    expect((await updateCategory(a, c.id, { parentId: null })).parentId).toBeNull();
  });
  it("ciclos: proprio pai e descendente como pai", async () => {
    const x = await createCategory(a, { name: "X" });
    const y = await createCategory(a, { name: "Y", parentId: x.id });
    const z = await createCategory(a, { name: "Z", parentId: y.id });
    await expect(updateCategory(a, x.id, { parentId: x.id })).rejects.toBeInstanceOf(ParentCycleError);
    await expect(updateCategory(a, x.id, { parentId: y.id })).rejects.toBeInstanceOf(ParentCycleError);
    await expect(updateCategory(a, x.id, { parentId: z.id })).rejects.toBeInstanceOf(ParentCycleError);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: x.id } })).parentId).toBeNull();
  });
  it("profundidade considera a subarvore que se move", async () => {
    const r1 = await createCategory(a, { name: "R1" });
    const r2 = await createCategory(a, { name: "R2" });
    const r2c = await createCategory(a, { name: "R2c", parentId: r2.id });
    // mover R2 (altura 2) para baixo de R1 (nivel 1) da 3 niveis: ok
    await updateCategory(a, r2.id, { parentId: r1.id });
    const r3 = await createCategory(a, { name: "R3" });
    const r3c = await createCategory(a, { name: "R3c", parentId: r3.id });
    // mover R3 (altura 2) para baixo de R2c (nivel 3) estoura
    await expect(updateCategory(a, r3.id, { parentId: r2c.id })).rejects.toBeInstanceOf(MaxDepthError);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: r3c.id } })).parentId).toBe(r3.id);
  });
  it("pai de outra loja: PARENT_NOT_FOUND; categoria de outra loja ou inexistente: NOT_FOUND", async () => {
    const mine = await createCategory(a, { name: "Minha" });
    const theirs = await createCategory(b, { name: "Deles" });
    await expect(updateCategory(a, mine.id, { parentId: theirs.id })).rejects.toBeInstanceOf(ParentNotFoundError);
    await expect(updateCategory(a, theirs.id, { name: "Hack" })).rejects.toBeInstanceOf(CategoryNotFoundError);
    await expect(updateCategory(a, "nao-existe", { name: "Hack" })).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect((await prisma.category.findUniqueOrThrow({ where: { id: theirs.id } })).name).toBe("Deles");
  });
});

describe("deleteCategory", () => {
  it("exclui categoria livre", async () => {
    const c = await createCategory(a, { name: "Livre" });
    await deleteCategory(a, c.id);
    expect(await prisma.category.findUnique({ where: { id: c.id } })).toBeNull();
  });
  it("com filha ou com produto: CATEGORY_IN_USE e nada some", async () => {
    const p = await createCategory(a, { name: "Pai" });
    await createCategory(a, { name: "Filha", parentId: p.id });
    await expect(deleteCategory(a, p.id)).rejects.toBeInstanceOf(CategoryInUseError);
    const q = await createCategory(a, { name: "ComProduto" });
    await mkProduct(a, q.id);
    await expect(deleteCategory(a, q.id)).rejects.toBeInstanceOf(CategoryInUseError);
    expect(await prisma.category.count({ where: { storeId: a } })).toBe(3);
  });
  it("categoria de outra loja ou inexistente: NOT_FOUND e nao exclui", async () => {
    const theirs = await createCategory(b, { name: "Deles" });
    await expect(deleteCategory(a, theirs.id)).rejects.toBeInstanceOf(CategoryNotFoundError);
    await expect(deleteCategory(a, "nao-existe")).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(await prisma.category.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });
});

describe("listCategories", () => {
  it("so da loja, com contagens de produtos e filhas", async () => {
    const p = await createCategory(a, { name: "Pai" });
    await createCategory(a, { name: "Filha", parentId: p.id });
    await mkProduct(a, p.id);
    await createCategory(b, { name: "Alheia" });
    const list = await listCategories(a);
    expect(list.map((c) => c.name).sort()).toEqual(["Filha", "Pai"]);
    expect(list.find((c) => c.name === "Pai")).toMatchObject({ productCount: 1, childCount: 1 });
  });
});

const hasCycle = (rows: { id: string; parentId: string | null }[]) => {
  const map = new Map(rows.map((r) => [r.id, r]));
  return rows.some((r) => {
    const seen = new Set<string>();
    for (let c: typeof r | undefined = r; c; c = c.parentId ? map.get(c.parentId) : undefined) {
      if (seen.has(c.id)) return true;
      seen.add(c.id);
    }
    return false;
  });
};
const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);

describe("concorrencia na arvore (trava da loja)", () => {
  it("PATCH A->B e B->A ao mesmo tempo: exatamente um passa, o outro PARENT_CYCLE, sem ciclo no banco", async () => {
    for (let i = 0; i < 6; i++) {
      const x = await createCategory(a, { name: `X${i}` });
      const y = await createCategory(a, { name: `Y${i}` });
      const r = await settle([updateCategory(a, x.id, { parentId: y.id }), updateCategory(a, y.id, { parentId: x.id })]);
      expect(r.filter((v) => v.status === "fulfilled"), `iteracao ${i}`).toHaveLength(1);
      const bad = r.find((v) => v.status === "rejected") as PromiseRejectedResult;
      expect(bad.reason).toBeInstanceOf(ParentCycleError);
      expect(hasCycle(await prisma.category.findMany({ where: { storeId: a }, select: { id: true, parentId: true } }))).toBe(false);
    }
  });
  it("criar filha sob pai de nivel 2 enquanto outra raiz com filha e movida para la: nunca passa de 3 niveis", async () => {
    for (let i = 0; i < 4; i++) {
      const l1 = await createCategory(a, { name: `L1-${i}` });
      const l2 = await createCategory(a, { name: `L2-${i}`, parentId: l1.id });
      const r = await createCategory(a, { name: `R-${i}` });
      await createCategory(a, { name: `Rc-${i}` , parentId: r.id });
      const res = await settle([
        createCategory(a, { name: `N-${i}`, parentId: l2.id }), // nivel 3
        updateCategory(a, r.id, { parentId: l2.id }), // subarvore de altura 2 sob nivel 2 = 4 niveis
      ]);
      const all = await prisma.category.findMany({ where: { storeId: a }, select: { id: true, parentId: true } });
      const map = new Map(all.map((c) => [c.id, c]));
      const level = (id: string) => { let n = 0; for (let c = map.get(id); c; c = c.parentId ? map.get(c.parentId) : undefined) n++; return n; };
      expect(Math.max(...all.map((c) => level(c.id))), `iteracao ${i}`).toBeLessThanOrEqual(3);
      expect(res.some((v) => v.status === "rejected" && v.reason instanceof MaxDepthError)).toBe(true);
    }
  });
});

describe("arvore ja corrompida (ciclo inserido direto no banco)", () => {
  async function corrupt() {
    const x = await createCategory(a, { name: "CX" });
    const y = await createCategory(a, { name: "CY", parentId: x.id });
    await prisma.$executeRaw`UPDATE "Category" SET "parentId" = ${y.id} WHERE id = ${x.id}`;
    return { x, y };
  }
  it("listCategories/buildTree nao travam e mostram os nos como orfaos", async () => {
    const { x, y } = await corrupt();
    const ok = await createCategory(a, { name: "Normal" });
    const { tree, orphans } = buildTree(await listCategories(a));
    expect(tree.map((n) => n.id)).toEqual([ok.id]);
    expect(orphans.map((n) => n.id).sort()).toEqual([x.id, y.id].sort());
  });
  it("PATCH de pai nos nos do ciclo devolve erro de dominio (nao RangeError)", async () => {
    const { x, y } = await corrupt();
    const root = await createCategory(a, { name: "Raiz" });
    await expect(updateCategory(a, x.id, { parentId: root.id })).rejects.toBeInstanceOf(ParentCycleError);
    await expect(updateCategory(a, root.id, { parentId: y.id })).rejects.toThrow(/Max|Cycle|níveis|ciclo|dentro/i);
    expect(await updateCategory(a, x.id, { name: "Renomeada" })).toMatchObject({ name: "Renomeada" }); // sem mexer no pai segue funcionando
    expect(await updateCategory(a, x.id, { parentId: null })).toMatchObject({ parentId: null }); // e a raiz desfaz o ciclo
  });
});
