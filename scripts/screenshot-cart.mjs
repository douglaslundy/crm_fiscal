import { chromium } from "playwright";
// uso: node scripts/screenshot-cart.mjs <origin> <email> <prefixo> <slug-produto>  (W/H opcionais via env)
// Loga como cliente, adiciona o produto ao carrinho (1a cor/tamanho disponiveis) e fotografa carrinho e checkout.
const [,, origin, email, prefix, slug] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 900) } });
const p = await ctx.newPage();
await p.goto(origin + "/api/auth/csrf");
const { csrfToken } = JSON.parse(await p.innerText("body"));
await p.evaluate(([c, e]) => fetch("/api/auth/callback/customer", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: c, email: e, password: "12345678", json: "true" }) }), [csrfToken, email]);
await p.goto(`${origin}/p/${slug}`, { waitUntil: "networkidle", timeout: 90000 });
for (const g of ["aria-pressed"]) for (const btn of await p.locator(`button[${g}]:not([disabled])`).all()) { await btn.click(); }
await p.getByRole("button", { name: "Adicionar ao carrinho" }).click();
await p.goto(origin + "/carrinho", { waitUntil: "networkidle", timeout: 90000 });
await p.screenshot({ path: `${prefix}cart.png`, fullPage: true });
await p.goto(origin + "/checkout", { waitUntil: "networkidle", timeout: 90000 });
await p.screenshot({ path: `${prefix}checkout.png`, fullPage: true });
await b.close();
