import { expect, test, type Browser } from "@playwright/test";
import { MASTER } from "./env";

const PORT = 3100;
const run = Date.now().toString(36);
const slug = `loja-${run}`;
const owner = { name: "Dona E2E", email: `dona-${run}@e2e.test`, password: "senha-e2e-123" };
const buyer = { name: "Cliente E2E", email: `cli-${run}@e2e.test`, password: "senha-e2e-123", cpf: "52998224725", phone: "35999990000" };
const store = (path = "/") => `http://${slug}.localhost:${PORT}${path}`;
const PRODUCT = `Camiseta ${run}`;

async function login(browser: Browser, url: string, email: string, password: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"));
  return { ctx, page };
}

test("lojista vende, cliente paga, master suspende", async ({ page, browser }) => {
  // 1. cadastro do lojista na plataforma
  await page.goto("/comecar");
  await page.getByLabel("Seu nome").fill(owner.name);
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Senha").fill(owner.password);
  await page.getByLabel("Nome da loja").fill(`Loja ${run}`);
  await page.getByLabel("Endereço (opcional)").fill(slug);
  await page.getByRole("button", { name: /Começar 14 dias/ }).click();
  await expect(page.getByRole("status")).toContainText("Loja criada!");

  // 2. painel da loja (login na propria loja)
  const admin = await login(browser, store("/entrar?next=/admin/categorias"), owner.email, owner.password);
  const a = admin.page;
  await expect(a.getByRole("heading", { name: "Categorias" })).toBeVisible();
  await a.getByLabel("Nome", { exact: true }).fill("Camisetas");
  await a.getByRole("button", { name: "Criar categoria" }).click();
  await expect(a.getByRole("heading", { name: "Camisetas" })).toBeVisible();

  // 3. produto com variacoes cor x tamanho
  await a.goto(store("/admin/produtos/novo"));
  await a.getByLabel("Nome", { exact: true }).fill(PRODUCT);
  await a.getByLabel("Categoria").selectOption({ label: "Camisetas" });
  await a.getByLabel("Peso (g)").fill("300");
  await a.getByLabel("Altura (cm)").fill("3");
  await a.getByLabel("Largura (cm)").fill("25");
  await a.getByLabel("Comprimento (cm)").fill("30");
  await a.getByLabel(/^Cores/).fill("Preto, Branco");
  await a.getByLabel(/^Tamanhos/).fill("M, G");
  await a.getByLabel(/^Preço \(R\$\)/).first().fill("59,90");
  await a.getByLabel("Estoque", { exact: true }).first().fill("5");
  await a.getByRole("button", { name: "Gerar variações" }).click();
  await expect(a.getByRole("cell", { name: "Branco", exact: true }).first()).toBeVisible();
  await a.getByRole("button", { name: "Criar produto" }).click();
  await expect(a).toHaveURL(/\/admin\/produtos\/(?!novo)[^/]+$/);

  // 4. visitante compra
  const vctx = await browser.newContext();
  const v = await vctx.newPage();
  await v.goto(store());
  await v.getByRole("link", { name: new RegExp(PRODUCT) }).first().click();
  await v.getByRole("button", { name: "Preto" }).click();
  await v.getByRole("button", { name: "M", exact: true }).click();
  await v.getByRole("button", { name: "Adicionar ao carrinho" }).click();
  await expect(v.getByText("Adicionado ao carrinho")).toBeVisible();

  await v.goto(store("/checkout"));
  await expect(v).toHaveURL(/\/loja-entrar\?next=%2Fcheckout/);
  await v.getByRole("link", { name: "Cadastre-se" }).click();
  await v.getByLabel("Nome", { exact: true }).fill(buyer.name);
  await v.getByLabel("E-mail").fill(buyer.email);
  await v.getByLabel("CPF").fill(buyer.cpf);
  await v.getByLabel("Telefone").fill(buyer.phone);
  await v.getByLabel("Senha").fill(buyer.password);
  await v.getByRole("button", { name: "Criar conta" }).click();
  await expect(v.getByRole("heading", { name: "Finalizar compra" })).toBeVisible();

  const form = v.locator("form").filter({ hasText: "Salvar endereço" });
  await form.getByLabel("CEP").fill("37175-000");
  await form.getByLabel("Rua").fill("Rua Teste");
  await form.getByLabel("Número").fill("10");
  await form.getByLabel("Bairro").fill("Centro");
  await form.getByLabel("Cidade").fill("Boa Esperança");
  await form.getByLabel("UF").fill("MG");
  await form.getByRole("button", { name: "Salvar endereço" }).click();
  await expect(v.getByRole("button", { name: "Fazer pedido" })).toBeEnabled(); // frete falso (PAC) ja vem escolhido
  await v.getByRole("button", { name: "Fazer pedido" }).click();

  await expect(v).toHaveURL(/\/pedido\//);
  await v.getByRole("button", { name: /^Cartão:/ }).click();
  await v.getByRole("button", { name: "Cartão aprovado" }).click(); // token "approved" do gateway falso
  await expect(v.getByText("Pagamento aprovado")).toBeVisible();

  // 5. pedido PAGO no painel
  await a.goto(store("/admin/pedidos"));
  await expect(a.getByRole("row", { name: new RegExp(buyer.email) })).toContainText("Pago");

  // 6. master suspende a loja
  const master = await login(browser, "/entrar?next=/master/lojas", MASTER.email, MASTER.password);
  const m = master.page;
  await m.goto(`/master/lojas?q=${slug}`);
  await m.getByRole("link", { name: `Loja ${run}` }).click();
  m.once("dialog", (d) => void d.accept());
  await m.getByRole("button", { name: "Suspender loja" }).click();
  await expect(m.getByText("Reativar loja")).toBeVisible();

  // 7. vitrine nao vende mais
  await v.goto(store());
  await expect(v.getByText("Loja indisponível")).toBeVisible();
  await v.goto(store("/checkout"));
  await expect(v.getByText("Loja indisponível")).toBeVisible();

  await Promise.all([admin.ctx, vctx, master.ctx].map((c) => c.close()));
});
