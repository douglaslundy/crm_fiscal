import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { rmSync } from "node:fs";

export const TEST_PORT = Number(process.env.TEST_DB_PORT ?? 54329);
export const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  `postgresql://postgres:postgres@localhost:${TEST_PORT}/ecomerce_test`;
const DATA_DIR = ".pgdata-test";

async function reachable(url: string) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

/** Reuses a running Postgres at TEST_URL, else boots embedded one. Returns stop(). */
export async function startTestDb(): Promise<() => Promise<void>> {
  if (await reachable(TEST_URL)) return async () => {};
  rmSync(DATA_DIR, { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: TEST_PORT,
    persistent: false,
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("ecomerce_test");
  return () => server.stop();
}

/** Drops everything and re-applies migrations. */
export async function resetSchema(url = TEST_URL) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await c.end();
}
