# Plataforma de lojas (SaaS)

Plataforma multi-loja: o lojista cria a loja em `/comecar` (14 dias de teste), gerencia categorias, produtos com variações (cor × tamanho) e pedidos em `/admin`, e vende na vitrine `<slug>.<PLATFORM_DOMAIN>` (ou domínio próprio). Pagamento por Mercado Pago (cartão e Pix, credenciais por loja), frete Melhor Envio, assinatura da plataforma cobrada via Mercado Pago. O master (`/master`) gerencia lojas e planos. Next.js 16, Prisma/PostgreSQL, next-auth.

## Rodando localmente

```bash
npm install
npm run db:test:start          # Postgres embutido (porta 54329); deixe rodando em outro terminal
# .env: DATABASE_URL=postgresql://postgres:postgres@localhost:54329/ecomerce_test (+ AUTH_SECRET, CREDENTIALS_KEY, SEED_MASTER_*)
npm run db:migrate             # ou: npx prisma migrate deploy
SEED_MASTER_EMAIL=voce@exemplo.com SEED_MASTER_PASSWORD=... npm run db:seed
npm run dev                    # http://localhost:3000; lojas em http://<slug>.localhost:3000
```

Fora de produção os gateways de pagamento, frete e cobrança são falsos (sem credenciais): no pedido há os botões "Cartão aprovado/recusado" e o frete é calculado localmente. Imagens vão para `public/uploads` sem `BLOB_READ_WRITE_TOKEN`.

Testes: `npm test` (vitest, sobe seu próprio Postgres de teste; não rode com `npm run db:test:start` ocupando a porta com outro banco), `npm run lint`, `npx tsc --noEmit`.

E2E (Playwright, fluxo completo lojista → cliente → pagamento → suspensão pelo master): `npx playwright install chromium` uma vez, depois `npm run e2e`. Sobe sozinho o Postgres embutido (recria o schema `ecomerce_test`) e o `next dev` na porta 3100 com valores descartáveis. Se já houver um Postgres na `DATABASE_URL_TEST`, ele é reaproveitado (e o schema é apagado: só aceita host local e banco terminando em `_test`).

## Variáveis de ambiente

| Variável | Para quê | Obrigatória em produção |
|---|---|---|
| `DATABASE_URL` | PostgreSQL da aplicação | sim |
| `AUTH_SECRET` | Segredo das sessões (`openssl rand -base64 32`) | sim |
| `PLATFORM_DOMAIN` | Domínio raiz (ex.: `minhaplataforma.com.br`); lojas ficam em `<slug>.` desse domínio | sim |
| `CREDENTIALS_KEY` | Chave AES-256-GCM das credenciais das lojas: 64 hex (`openssl rand -hex 32`). Perder a chave invalida as credenciais salvas | sim |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (upload de imagens) | sim |
| `BILLING_MP_ACCESS_TOKEN` | Access token do Mercado Pago da plataforma (cobra as assinaturas) | sim |
| `BILLING_WEBHOOK_SECRET` | Segredo do webhook de cobrança (assinatura `x-signature`) | sim |
| `CRON_SECRET` | Autoriza as rotas `/api/cron/*` (a Vercel envia `Authorization: Bearer`) | sim |
| `SEED_MASTER_EMAIL`, `SEED_MASTER_PASSWORD` | Conta master criada por `db:seed` (senha: mínimo 8 caracteres) | só ao semear |
| `PLATFORM_CNAME_TARGET` | Alvo do CNAME dos domínios próprios (padrão `cname.vercel-dns.com`) | não |
| `MELHOR_ENVIO_BASE_URL`, `MELHOR_ENVIO_USER_AGENT` | Sobrescrevem URL (ex.: sandbox) e User-Agent do Melhor Envio | não |
| `DATABASE_URL_TEST`, `TEST_DB_PORT` | Banco/porta dos testes e do e2e | não (só dev) |

`NEXTAUTH_URL` e `VERCEL_API_TOKEN` não são lidas pelo código (a API de domínios da Vercel não é chamada; ver limites).

Fora da Vercel (servidor próprio, Docker etc.), o next-auth precisa de `AUTH_TRUST_HOST=true` para confiar no host da requisição (subdomínios e domínios próprios das lojas).

## Checklist de deploy (dono da plataforma)

1. Criar o projeto na Vercel apontando para este repositório e um PostgreSQL gerenciado.
2. Domínio: adicionar `PLATFORM_DOMAIN` e o wildcard `*.PLATFORM_DOMAIN` ao projeto (DNS conforme a Vercel indicar).
3. Definir as variáveis acima (Production) e criar um Blob store.
4. Aplicar as migrações: `DATABASE_URL=... npx prisma migrate deploy`.
5. Semear: `DATABASE_URL=... SEED_MASTER_EMAIL=... SEED_MASTER_PASSWORD=... npm run db:seed` (cria planos, master e a loja de exemplo `demo`; apague a `demo` se não quiser).
6. Mercado Pago da plataforma: registrar o webhook `https://PLATFORM_DOMAIN/api/webhooks/billing` com o mesmo segredo de `BILLING_WEBHOOK_SECRET`.
7. Cada lojista informa suas credenciais do Mercado Pago (incluindo o segredo do webhook) em `/admin/configuracoes`. O pagamento já envia a `notification_url` `https://<slug>.PLATFORM_DOMAIN/api/webhooks/mercadopago/<storeId>`; ela não aparece na tela de configurações (v1), então, se o lojista registrar o webhook no painel do MP, use essa URL.
8. Crons (`vercel.json`): `/api/cron/billing` de hora em hora e `/api/cron/expire-orders` a cada 5 minutos. Isso exige o plano Vercel Pro (Hobby só aceita execução diária). Alternativa: um agendador externo chamando as duas rotas com `Authorization: Bearer $CRON_SECRET`.
9. Domínio próprio de uma loja: o dono adiciona o domínio manualmente no projeto da Vercel (ver limites).

## Limites conhecidos (v1)

- Limites de taxa (rate limit) ficam em memória, por instância.
- `clientIp` assume o `x-forwarded-for` da Vercel.
- A verificação de domínio próprio (CNAME) não prova a posse do domínio; token TXT por loja pendente.
- A API de domínios da Vercel não é chamada: o dono adiciona os domínios próprios na Vercel manualmente.
- Loja suspensa pelo master continua sendo cobrada pelo Mercado Pago até a assinatura ser pausada lá.
- Cancelar/reembolsar pedido pago é manual (409 `REEMBOLSO_MANUAL`); os alertas (`PAID_FOR_CANCELED_ORDER`, `DUPLICATE_PAYMENT`, `PAYMENT_UNRECONCILABLE`) são apenas linhas JSON em `console.error`.
- O payload do Melhor Envio não foi verificado contra a API real.
- O Brick e a API REST do Mercado Pago não foram exercitados contra o serviço real.
- Um pagamento de cobrança rejeitado que chega tarde pode marcar a loja como `PAST_DUE`.
- A exibição do valor da parcela arredonda para baixo.
- Mesma chave de idempotência com carrinho diferente devolve o pedido antigo.
- Os números dos planos (Start etc.) são editáveis pelo master.
- Clientes de uma loja suspensa ou cancelada não conseguem entrar nem ver seus pedidos.
- O lojista não consegue cancelar um pedido enquanto houver pagamento em andamento (Pix vigente ou cartão em análise): 409 `PAGAMENTO_EM_ABERTO`; o cron cancela no vencimento (cartão em análise: até 72 h).
- Desconto no Pix limitado a 50%.
- Convite de equipe não envia e-mail: para um e-mail sem conta, o painel mostra uma única vez um link (válido por 7 dias) que o dono repassa ao convidado.
- Fuso fixo em UTC-3 (Brasil sem horário de verão desde 2019); revisar se o DST voltar.
- Exportação CSV limitada a 20.000 pedidos (mais recentes); as métricas leem o período inteiro em lotes.
- Cupons: o limite de uma vez por cliente é conferido sem trava; dois pedidos simultâneos do mesmo cliente podem usar o mesmo cupom duas vezes. O limite total de usos é atômico.
