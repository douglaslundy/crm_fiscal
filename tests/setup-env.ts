// O cliente de src/lib/db.ts le DATABASE_URL: nos testes ele aponta para o banco de teste.
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
// Valores fixos de teste (nunca segredos reais).
process.env.AUTH_SECRET = "segredo-fixo-so-para-testes";
process.env.PLATFORM_DOMAIN = "localhost";
