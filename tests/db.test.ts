import { expect, it } from "vitest";
import pg from "pg";

it("conecta no Postgres de teste", async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_TEST });
  await c.connect();
  const r = await c.query("SELECT 1 AS ok");
  await c.end();
  expect(r.rows[0].ok).toBe(1);
});
