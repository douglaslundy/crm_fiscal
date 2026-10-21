import { chromium } from "playwright";
// uso: node _shot-auth.mjs <origin> <email> <provider> <saida-prefixo> <caminho>...
const [,, origin, email, provider, prefix, ...paths] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.goto(origin + "/api/auth/csrf");
const { csrfToken } = JSON.parse(await p.innerText("body"));
await p.evaluate(([c, e, pr]) => fetch(`/api/auth/callback/${pr}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: c, email: e, password: "12345678", json: "true" }) }), [csrfToken, email, provider]);
let i = 0;
for (const path of paths) {
  await p.goto(origin + path, { waitUntil: "networkidle", timeout: 90000 });
  await p.screenshot({ path: `${prefix}${i++}.png`, fullPage: true });
}
await b.close();
