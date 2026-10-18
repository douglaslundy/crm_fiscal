import { startTestDb, TEST_URL } from "./test-db";

const stop = await startTestDb();
console.log(`Postgres de teste pronto. DATABASE_URL_TEST=${TEST_URL}`);
console.log("Ctrl+C para encerrar.");
process.on("SIGINT", async () => {
  await stop();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
