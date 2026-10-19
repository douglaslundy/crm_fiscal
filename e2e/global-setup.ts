import { execSync } from "node:child_process";
import { startTestDb, resetSchema, TEST_URL } from "../scripts/test-db";
import { MASTER } from "./env";

// Sobe o Postgres embutido (ou reaproveita o ja rodando), recria o schema e semeia o master.
export default async function setup() {
  const stop = await startTestDb();
  try {
    await resetSchema();
    execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: TEST_URL } });
    execSync("npx tsx prisma/seed.ts", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL, SEED_MASTER_EMAIL: MASTER.email, SEED_MASTER_PASSWORD: MASTER.password },
    });
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
