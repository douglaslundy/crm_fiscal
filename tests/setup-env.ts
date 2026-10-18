// O cliente de src/lib/db.ts le DATABASE_URL: nos testes ele aponta para o banco de teste.
if (process.env.DATABASE_URL_TEST) process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
