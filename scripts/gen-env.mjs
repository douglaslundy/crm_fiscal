import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
// uso: node scripts/gen-env.mjs <dominio> <email-do-master> [--write]
// Gera o .env de producao para o docker compose com segredos novos. Sem --write so imprime; com --write nunca sobrescreve um .env existente.
const [domain, masterEmail, flag] = process.argv.slice(2);
if (!domain || !masterEmail || domain.startsWith("-") || !masterEmail.includes("@")) {
  console.error("uso: node scripts/gen-env.mjs <dominio> <email-do-master> [--write]");
  process.exit(1);
}
const hex = (n) => randomBytes(n).toString("hex");
const masterPassword = randomBytes(15).toString("base64url");
const env = `NEXTAUTH_URL=https://${domain}
PLATFORM_DOMAIN=${domain}
AUTH_SECRET=${randomBytes(32).toString("base64")}
CREDENTIALS_KEY=${hex(32)}
CRON_SECRET=${hex(24)}
BILLING_WEBHOOK_SECRET=${hex(24)}
DB_PASSWORD=${hex(24)}
SEED_MASTER_EMAIL=${masterEmail}
SEED_MASTER_PASSWORD=${masterPassword}
SEED_DEMO=0
APP_BIND=127.0.0.1
APP_PORT=3500
# Preencha: SMTP_URL, MAIL_FROM, BILLING_MP_ACCESS_TOKEN
SMTP_URL=
MAIL_FROM=Loja <no-reply@${domain}>
BILLING_MP_ACCESS_TOKEN=
`;
if (flag === "--write") {
  if (existsSync(".env")) {
    console.error(".env ja existe: nao sobrescrevi. Rode sem --write e copie o que precisar.");
    process.exit(1);
  }
  writeFileSync(".env", env, { mode: 0o600 });
  console.log(`.env criado. Senha inicial do master (${masterEmail}): ${masterPassword}`);
} else {
  console.log(env);
}
