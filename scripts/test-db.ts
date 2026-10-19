import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { rmSync } from "node:fs";

export const TEST_PORT = Number(process.env.TEST_DB_PORT ?? 54329);
export const TEST_URL =
  process.env.DATABASE_URL_TEST ??
  `postgresql://postgres:postgres@localhost:${TEST_PORT}/ecomerce_test`;
const DATA_DIR = ".pgdata-test";

/** Refuses anything that is not a local *_test database (resetSchema is destructive). */
export function assertSafeTestUrl(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("DATABASE_URL_TEST invalida");
  }
  const db = decodeURIComponent(u.pathname.slice(1));
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !db.endsWith("_test")) {
    throw new Error(
      `DATABASE_URL_TEST insegura (${u.hostname}/${db}): exige host localhost/127.0.0.1 e banco terminando em _test`,
    );
  }
}

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
  assertSafeTestUrl(TEST_URL);
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
  assertSafeTestUrl(url);
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await c.end();
}
