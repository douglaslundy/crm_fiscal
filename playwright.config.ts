import { defineConfig } from "@playwright/test";
import { TEST_URL } from "./scripts/test-db";

const PORT = 3100;

// Servidor `next dev` (NODE_ENV != production): gateways falsos de pagamento/frete/cobranca ativos.
// Chromium resolve *.localhost, entao `<slug>.localhost:3100` chega ao mesmo servidor.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 }, // next dev compila rotas sob demanda
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: TEST_URL,
      AUTH_SECRET: "e2e-secret-descartavel",
      PLATFORM_DOMAIN: "localhost",
      CREDENTIALS_KEY: "0123456789abcdef".repeat(4),
      CRON_SECRET: "e2e-cron",
      BILLING_WEBHOOK_SECRET: "e2e-billing",
      BILLING_MP_ACCESS_TOKEN: "",
      BLOB_READ_WRITE_TOKEN: "",
    },
  },
});
