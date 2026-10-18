import { startTestDb, TEST_URL } from "./test-db";

async function main() {
  const stop = await startTestDb();
  console.log(`Postgres de teste pronto. DATABASE_URL_TEST=${TEST_URL}`);
  console.log("Ctrl+C para encerrar.");
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, async () => {
      await stop();
      process.exit(0);
    });
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
