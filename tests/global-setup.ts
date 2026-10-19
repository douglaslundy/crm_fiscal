import { execSync } from "node:child_process";
import { startTestDb, resetSchema, TEST_URL } from "../scripts/test-db";

export default async function setup() {
  const stop = await startTestDb();
  try {
    process.env.DATABASE_URL_TEST = TEST_URL;
    await resetSchema();
    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_URL },
    });
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
