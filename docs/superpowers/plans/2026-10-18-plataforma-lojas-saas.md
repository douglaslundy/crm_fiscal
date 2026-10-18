# Plataforma SaaS de lojas de moda: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plataforma multi-loja: lojistas se cadastram, testam 14 dias, assinam um plano e operam uma loja de roupas completa (vitrine, carrinho, checkout Mercado Pago transparente, frete, painel); o master gerencia tudo.

**Architecture:** Aplicação Next.js única, banco único com `storeId` em toda tabela de loja, acesso por extensão do Prisma que injeta o filtro. Regras puras em `src/domain/`; integrações externas em `src/integrations/` atrás de interfaces com versão falsa. A loja é resolvida pelo host (subdomínio ou domínio próprio).

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma + PostgreSQL, Auth.js (credenciais, JWT), Zod, Vitest, Playwright, Vercel Blob, Mercado Pago, Melhor Envio.

**Spec:** `docs/superpowers/specs/2026-10-18-plataforma-lojas-saas-design.md`

## Global Constraints

- Dinheiro em centavos inteiros (`priceCents: number`); formatar só na UI (BRL). Texto de interface em português do Brasil.
- Toda tabela de loja tem `storeId`; todo acesso passa por `dbForStore(storeId)`. Consulta sem escopo a tabela de loja é bug.
- Preço, estoque, frete e limites do plano vêm sempre do servidor; o navegador só envia `{variantId, qty}`.
- Credenciais de loja criptografadas (AES-256-GCM, `CREDENTIALS_KEY`) e nunca devolvidas por API (só `{configured:boolean; last4:string}`).
- Nenhum dado de cartão no servidor, só o token do Mercado Pago.
- `/master/**` exige `Account.isMaster`; `/admin/**` e `/api/admin/**` exigem `StoreMember` da loja do host; verificado no servidor.
- Estoque reservado ao criar pedido; devolvido em cancelamento, recusa ou expiração (Pix 30 min).
- CEP de origem vem de `StoreSetting.originCep` (padrão `37175000`). Sem credenciais do Mercado Pago, `FakeGateway` (cartão com token `"ok"` aprova) e `FakeBilling`; Melhor Envio idem com `FakeShipping`.
- Commits locais; sem push sem pedido do dono. Testes são versionados.
- Segredos só em `.env`; `.env.example` lista nomes.

## Review Focus

1. Vazamento entre lojas: consulta com `storeId` de outra loja devolve vazio; ID de pedido/produto de outra loja dá 404 (Task 3, 12, 17).
2. Lojista acima do limite do plano (51º produto no Start, 2º admin no Start, domínio próprio no Start): servidor recusa com 403 e mensagem (Task 6).
3. Webhook duplicado, fora de ordem ou com assinatura inválida, de vendas e de assinatura: transição única, 401 sem efeito (Task 7, 16).
4. Loja `SUSPENDED` ou teste vencido: vitrine não vende, painel só lê, dados intactos; reativação restaura (Task 7).
5. Duas compras simultâneas da última unidade: uma passa (Task 15). Host desconhecido: página 404 neutra, sem expor outras lojas (Task 3).

---

### Task 1: Scaffold e tooling

**Files:** projeto Next.js na raiz de `ecomerce/` (TypeScript, App Router, `src/`), `vitest.config.ts`, `.env.example`, `prisma/schema.prisma`; Modify `.gitignore` (`.superpowers/`, `.env*` exceto `.env.example`).

**Interfaces:** Produces scripts `dev`, `build`, `test` (`vitest run`), `db:migrate`, `db:seed`; `formatBRL(cents:number):string` em `src/domain/money.ts`.

- [ ] **Step 1:** `git init` em `ecomerce/` (hoje sem `.git`; decisão minha) e `create-next-app` (TS, App Router, ESLint, `src/`).
- [ ] **Step 2:** Instalar `prisma @prisma/client zod vitest next-auth bcryptjs @vercel/blob`; `vitest.config.ts` com alias `@ -> src`.
- [ ] **Step 3:** Teste `money.test.ts`: `formatBRL(8990)` contém `89,90` e `R$`. Falhar; implementar com `Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"})`; passar.
- [ ] **Step 4:** `npm run build` passa. Commit `chore: scaffold`.

### Task 2: Schema multi-loja e seed

**Files:** Modify `prisma/schema.prisma`; Create `prisma/seed.ts`, `src/lib/db.ts` (`prisma` bruto, uso restrito a código de plataforma).

**Interfaces:** Produces modelos de plataforma `Account{id,name,email @unique,passwordHash,isMaster}`, `Store{id,slug @unique,name,status:StoreStatus,planId,trialEndsAt?,graceEndsAt?,createdAt}`, `StoreMember{storeId,accountId,role:MemberRole}` (`@@id([storeId,accountId])`), `StoreDomain{id,storeId,host @unique,verified}`, `Plan{id,name,priceCents,productLimit Int?,staffLimit,customDomain,advancedMetrics,csvExport,transactionFeeBps @default(0),active}`, `Subscription{id,storeId @unique,status:SubStatus,mpPreapprovalId? @unique,currentPeriodEnd?}`; modelos de loja (todos com `storeId`) `Customer{...,cpf,phone,passwordHash}` (`@@unique([storeId,email])`), `Address`, `Category{parentId?}` (`@@unique([storeId,slug])`), `Product{weightGrams,heightCm,widthCm,lengthCm,active}`, `ProductImage{color?,position}`, `Variant{sku,color,size,priceCents,stock,active}` (`@@unique([storeId,sku])`, `@@unique([productId,color,size])`, CHECK `stock >= 0` em migration SQL), `Order{status,subtotalCents,shippingCents,totalCents,shippingService,trackingCode?,addressSnapshot Json,mpPaymentId? @unique,pixQrCode?,pixExpiresAt?}`, `OrderItem` (snapshots), `StoreSetting{storeId,key,value}` (`@@id([storeId,key])`). Enums `StoreStatus{TRIAL,ACTIVE,SUSPENDED,CANCELED}`, `SubStatus{TRIALING,ACTIVE,PAST_DUE,SUSPENDED,CANCELED}`, `MemberRole{OWNER,STAFF}`, `OrderStatus{PENDING_PAYMENT,PAID,SHIPPED,DELIVERED,CANCELED}`.

- [ ] **Step 1:** Escrever schema e `prisma migrate dev --name init`; adicionar CHECK de estoque.
- [ ] **Step 2:** `seed.ts` idempotente (`upsert`): master (`SEED_MASTER_EMAIL`/`SEED_MASTER_PASSWORD`), planos Start (4900, 50, 1, false, false, false), Pro (12900, 500, 5, true, true, false), Business (34900, null, 15, true, true, true), 1 loja demo `demo` com 2 categorias, 3 produtos com variações, settings `originCep=37175000`, `pixDiscountPercent=0`.
- [ ] **Step 3:** Seed roda duas vezes sem erro. Commit `feat: multi-tenant schema and seed`.

### Task 3: Resolução da loja e acesso escopado

**Files:** Create `src/lib/tenant.ts`, `src/lib/tenant.test.ts`, `src/lib/db-store.ts`, `src/lib/db-store.test.ts`, `src/middleware.ts`.

**Interfaces:** Produces `resolveStoreByHost(host:string, platformDomain:string): Promise<Store|null>` (`slug.platformDomain` ou `StoreDomain.host` verificado); `dbForStore(storeId:string)` = cliente Prisma com extensão que força `storeId` em `where` de leitura/atualização/exclusão e em `data` de criação para todos os modelos de loja, e lança erro se for passado `storeId` diferente; `getCurrentStore(): Promise<Store>` (lê o host da requisição, 404 se não achar).

- [ ] **Step 1:** Testes (banco de teste): `demo.plataforma.test` resolve a loja demo; host desconhecido → `null`; domínio próprio não verificado → `null`; com duas lojas, `dbForStore(A).product.findMany()` não devolve produto de B; `dbForStore(A).product.findUnique({where:{id: idDeB}})` → `null`; `create` com `storeId` de B lança erro.
- [ ] **Step 2:** Implementar via `prisma.$extends` sobre todas as operações dos modelos de loja; passar.
- [ ] **Step 3:** Middleware encaminha host de loja às rotas da vitrine, host da plataforma ao site/`/master`; host desconhecido → página 404 neutra. Commit `feat: tenant resolution and scoped db`.

### Task 4: Autenticação (contas e clientes)

**Files:** Create `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/domain/cpf.ts`, `src/domain/cpf.test.ts`, `src/lib/guards.ts`, páginas `/entrar` (plataforma), `/loja-entrar` e `/cadastro` (comprador, na loja).

**Interfaces:** Produces `isValidCpf(cpf:string):boolean`; dois provedores de credenciais (`account`, `customer`), JWT com `kind: "account"|"customer"`, `id`, `isMaster?`, `storeId?` (cliente); `requireMaster()`, `requireStoreMember(storeId, role?)`, `requireCustomer(storeId)` (lançam/redirecionam); `POST /api/register-customer` `{name,email,cpf,phone,password}` no host da loja.

- [ ] **Step 1:** Testes `isValidCpf`: `"529.982.247-25"` true; `"111.111.111-11"` false; `"123"` false. Falhar, implementar, passar.
- [ ] **Step 2:** Provedores com bcrypt; cliente só autentica na loja do host (mesmo email em outra loja é outra conta). Sessão de cliente de A não vale em B (teste).
- [ ] **Step 3:** Registro de cliente valida Zod + CPF, 409 para email repetido na mesma loja, nunca devolve hash. Commit `feat: auth`.

### Task 5: Cadastro de lojista e criação de loja

**Files:** Create `src/app/(plataforma)/comecar/page.tsx`, `src/app/api/signup/route.ts`, `src/domain/stores.ts`, `src/domain/stores.test.ts`.

**Interfaces:** Produces `createStore(input:{ownerName; email; password; storeName; slug?; planId}, deps:{db}): Promise<{store:Store; account:Account}>` (cria `Account` OWNER, `Store` em `TRIAL` com `trialEndsAt = agora + 14 dias`, `Subscription` `TRIALING`, settings padrão); `slugify(text):string`; `isSlugAvailable(slug):Promise<boolean>` (rejeita reservados `www`, `app`, `admin`, `master`, `api`).

- [ ] **Step 1:** Testes: `slugify("Minha Loja Ótima")==="minha-loja-otima"`; slug reservado → erro; slug repetido → sufixo numérico ou erro 409 (escolher erro 409); `trialEndsAt` = 14 dias após `now` injetado; email já existente → 409.
- [ ] **Step 2:** Implementar, passar. Página de cadastro com escolha de plano (dados vindos de `Plan` ativos). Master também usa `createStore` (Task 8). Commit `feat: store signup with trial`.

### Task 6: Planos e limites

**Files:** Create `src/domain/entitlements.ts`, `src/domain/entitlements.test.ts`; Modify rotas de produtos, equipe, domínio, métricas para chamarem as verificações.

**Interfaces:** Produces `assertCanAddProduct(storeId:string): Promise<void>`, `assertCanAddStaff(storeId)`, `assertCanUseCustomDomain(storeId)`, `getFeatures(storeId): Promise<{advancedMetrics:boolean; csvExport:boolean}>`; erro `PlanLimitError{code:"PRODUCT_LIMIT"|"STAFF_LIMIT"|"DOMAIN_NOT_ALLOWED"; limit?:number}` mapeado para HTTP 403.

- [ ] **Step 1:** Testes: Start com 50 produtos → `PRODUCT_LIMIT` ao 51º; Business (`productLimit` nulo) nunca barra; Start com 1 membro → `STAFF_LIMIT`; Start → `DOMAIN_NOT_ALLOWED`; trocar plano para Pro libera sem recriar dados.
- [ ] **Step 2:** Implementar, passar. Commit `feat: plan entitlements`.

### Task 7: Assinatura e ciclo de vida da loja

**Files:** Create `src/integrations/billing/types.ts`, `.../fakeBilling.ts`, `.../mercadopagoBilling.ts`, `src/domain/subscription.ts`, `src/domain/subscription.test.ts`, `src/app/api/webhooks/billing/route.ts`, `src/app/api/cron/billing/route.ts`, `src/app/admin/assinatura/page.tsx`.

**Interfaces:** Produces `interface BillingGateway { createSubscription(input:{storeId; planId; payerEmail}): Promise<{checkoutUrl:string; externalId:string}>; changePlan(externalId, planId): Promise<void>; cancel(externalId): Promise<void>; getSubscription(externalId): Promise<{status:"authorized"|"pending"|"paused"|"cancelled"; nextPaymentAt:Date|null}>; verifyWebhook(headers, dataId):boolean }`; `applyBillingEvent(storeId, status, now:Date): Promise<void>`; `evaluateStoreLifecycle(now:Date): Promise<{suspended:string[]; pastDue:string[]}>` (cron).

- [ ] **Step 1:** Testes com `FakeBilling` e relógio injetado: autorizado → loja `ACTIVE`; teste vencido sem assinatura → `SUSPENDED`; falha de pagamento → `PAST_DUE` e `graceEndsAt = +3 dias`, depois `SUSPENDED`; webhook repetido → mesma transição uma vez; assinatura retomada reativa a loja; assinatura de uma loja nunca altera outra.
- [ ] **Step 2:** Implementar, passar. Guarda `assertStoreCanSell(store)` (vitrine) e `assertStoreWritable(store)` (painel) usadas pelas rotas: `SUSPENDED`/`CANCELED` bloqueia vendas e escrita no painel; leitura continua.
- [ ] **Step 3:** Cron (`CRON_SECRET`) chama `evaluateStoreLifecycle` a cada hora; página "Assinatura" no painel do lojista (plano atual, trocar plano, cancelar, link de pagamento). Commit `feat: subscriptions and store lifecycle`.

### Task 8: Painel master

**Files:** Create `src/app/master/**` (lojas, planos, métricas), `src/app/api/master/**`, `src/domain/platformMetrics.ts`, `src/domain/platformMetrics.test.ts`.

**Interfaces:** Consumes `createStore`, `requireMaster`. Produces `computePlatformMetrics(stores: StoreRow[], now:Date): {activeStores:number; trialingStores:number; suspendedStores:number; mrrCents:number; storesByPlan:{planName:string; count:number}[]; signupsByDay:{date:string; count:number}[]}`; MRR soma só lojas `ACTIVE`.

- [ ] **Step 1:** Testes: `TRIAL` e `SUSPENDED` não entram no MRR; zero lojas → tudo `0`/vazio sem divisão por zero.
- [ ] **Step 2:** Implementar, passar. Telas: lista de lojas (filtros por status/plano), criar loja manualmente (com ou sem teste, plano, dono), suspender/reativar, trocar plano, CRUD de planos (`Plan`, desativar em vez de excluir se houver lojas), métricas. Acesso por não-master → 403 (teste de rota). Commit `feat: master panel`.

### Task 9: Admin da loja: categorias

**Files:** Create `src/app/admin/categorias/**`, `src/app/api/admin/categories/**`, `src/domain/slug.ts` (reaproveita `slugify`).

- [ ] **Step 1:** CRUD com `dbForStore`, Zod, slug único por loja, excluir categoria com produtos ou filhas → 409; categoria de outra loja → 404 (teste).
- [ ] **Step 2:** Páginas lista + formulário (com categoria pai). Commit `feat: store categories`.

### Task 10: Admin da loja: produtos, variações e imagens

**Files:** Create `src/app/admin/produtos/**`, `src/app/api/admin/products/**`, `src/app/api/admin/upload/route.ts`, `src/domain/variants.ts`, `src/domain/variants.test.ts`.

**Interfaces:** Produces `expandVariants(colors:string[], sizes:string[], base:{priceCents:number; stock:number}, skuPrefix:string): VariantInput[]` (produto cartesiano, SKU `prefixo-cor-tamanho`); `POST /api/admin/upload` → `{url}` (só imagem até 5 MB, pasta `stores/<storeId>/`).

- [ ] **Step 1:** Testes: 2 cores × 3 tamanhos → 6 itens, SKUs únicos; listas vazias → `[]`; preço negativo → erro.
- [ ] **Step 2:** Implementar, passar. Formulário: dados, categoria, peso/dimensões obrigatórios, imagens (cor opcional), variações editáveis. Criar produto chama `assertCanAddProduct`; produto ativo exige variação ativa. Upload rejeita não-imagem e >5 MB (400). Commit `feat: store products`.

### Task 11: Admin da loja: configurações, credenciais, equipe e domínio

**Files:** Create `src/app/admin/configuracoes/**`, `src/app/api/admin/settings/route.ts`, `src/app/api/admin/credentials/route.ts`, `src/app/api/admin/team/route.ts`, `src/app/api/admin/domain/route.ts`, `src/lib/crypto.ts`, `src/lib/crypto.test.ts`, `src/domain/cep.ts`, `src/domain/cep.test.ts`.

**Interfaces:** Produces `encrypt(plain:string):string` / `decrypt(payload:string):string` (AES-256-GCM, IV aleatório); `normalizeCep(raw:string):string|null`; `getStoreCredentials(storeId): Promise<{mpAccessToken?; mpPublicKey?; mpWebhookSecret?; melhorEnvioToken?}>` (uso interno servidor); API de credenciais só devolve `{configured, last4}`.

- [ ] **Step 1:** Testes: `decrypt(encrypt(x))===x`; dois `encrypt` do mesmo texto diferem; payload adulterado lança erro; `normalizeCep("37175-000")==="37175000"`, `"123"→null`.
- [ ] **Step 2:** Implementar, passar. Telas: `originCep`, `pixDiscountPercent` (0–100), credenciais Mercado Pago e Melhor Envio, equipe (convidar membro, chama `assertCanAddStaff`; só OWNER convida), domínio próprio (`assertCanUseCustomDomain`, instrução de DNS, `verified` após checagem). Teste de API: resposta de credenciais nunca contém o segredo. Commit `feat: store settings and credentials`.

### Task 12: Vitrine pública

**Files:** Create `src/app/(loja)/page.tsx`, `.../c/[slug]/page.tsx`, `.../p/[slug]/page.tsx`, `.../buscar/page.tsx`, `src/domain/catalog.ts`, `src/domain/catalog.test.ts`; Modify `src/domain/money.ts`.

**Interfaces:** Produces `parseCatalogFilters(params:URLSearchParams): {category?; sizes:string[]; colors:string[]; minCents?; maxCents?; q?; page:number}`; `listProducts(storeId, filters): Promise<{items:ProductCard[]; total:number}>` (só ativos com variação ativa); `installments(priceCents:number, minInstallmentCents=9000, maxInstallments=3):{count:number; valueCents:number}`.

- [ ] **Step 1:** Testes: `?size=M&size=G&min=5000` → `sizes:["M","G"], minCents:5000`; `?page=abc`→`1`; `?min=-5` ignora; `installments`: 8990→1x, 27000→3x de 9000, 10000→1x.
- [ ] **Step 2:** Implementar, passar. Páginas: home, listagem com filtros e paginação, produto com cor/tamanho, menu com subcategorias, cards com selo "Esgotado", preço no Pix (só se `pixDiscountPercent>0`) e parcelamento, "última peça" (estoque 1), JSON-LD `Product`. Loja `SUSPENDED` mostra aviso e esconde compra. Teste: produto de outra loja pelo slug → 404. Commit `feat: storefront`.

### Task 13: Carrinho

**Files:** Create `src/lib/cart-store.ts`, `src/app/(loja)/carrinho/page.tsx`, `src/domain/cart.ts`, `src/domain/cart.test.ts`, `src/app/api/cart/price/route.ts`.

**Interfaces:** Produces `CartLine={variantId:string; qty:number}`; `priceCart(lines, variants:VariantRow[]): {lines:PricedLine[]; subtotalCents:number; issues:CartIssue[]}` com `CartIssue={variantId; kind:"INACTIVE"|"OUT_OF_STOCK"|"QTY_REDUCED"; available:number}`; `POST /api/cart/price`.

- [ ] **Step 1:** Testes: preço vem da variação, não da linha; inativa → `INACTIVE` fora do subtotal; qty acima do estoque → `QTY_REDUCED`; qty ≤ 0 descartada; variação de outra loja → ignorada com `INACTIVE`.
- [ ] **Step 2:** Implementar, passar; carrinho em localStorage (chave por loja) e página. Commit `feat: cart`.

### Task 14: Frete

**Files:** Create `src/integrations/shipping/types.ts`, `melhorEnvio.ts`, `fakeShipping.ts`, `src/domain/shipping.ts`, `src/domain/shipping.test.ts`, `src/app/api/shipping/quote/route.ts`.

**Interfaces:** Produces `interface ShippingProvider { quote(input:{fromCep; toCep; packages:Package[]}): Promise<ShippingOption[]> }`, `ShippingOption={service:string; priceCents:number; days:number}`; `buildPackages(lines:PricedLine[]):Package[]`; `POST /api/shipping/quote` `{cep, lines}` usa `originCep` e o token Melhor Envio **da loja**.

- [ ] **Step 1:** Testes: `buildPackages` soma pesos e respeita mínimos dos Correios; provedor que lança erro → 502 `{error:"FRETE_INDISPONIVEL"}`; CEP inválido → 400; loja sem token → usa `FakeShipping` só em desenvolvimento, em produção responde `FRETE_NAO_CONFIGURADO`.
- [ ] **Step 2:** Implementar (`/api/v2/me/shipment/calculate`), cache 10 min por (loja, CEP, pacotes); cotação no produto e no carrinho. Commit `feat: shipping`.

### Task 15: Checkout e pedido

**Files:** Create `src/app/(loja)/checkout/page.tsx`, `src/domain/orders.ts`, `src/domain/orders.test.ts`, `src/app/api/checkout/order/route.ts`.

**Interfaces:** Consumes `priceCart`, `ShippingProvider`, `dbForStore`. Produces `createOrder(input:{storeId; customerId; lines; addressId; shippingService}, deps): Promise<Order>` (transação: reprecifica, recota frete, `UPDATE variant SET stock = stock - qty WHERE id=? AND stock>=qty`, 0 linhas → `OutOfStockError`); `cancelOrder(storeId, orderId): Promise<void>` (devolve estoque, idempotente).

- [ ] **Step 1:** Testes: pedido grava snapshots e totais; frete do cliente ignorado; última unidade em `Promise.all` → um pedido, um `OutOfStockError`; `cancelOrder` duas vezes devolve estoque uma vez; loja `SUSPENDED` → `StoreSuspendedError`.
- [ ] **Step 2:** Implementar, passar. Checkout exige sessão de cliente (`/loja-entrar?next=/checkout`, carrinho preservado), endereço, frete e segue ao pagamento. Commit `feat: checkout`.

### Task 16: Pagamento das vendas (Mercado Pago da loja) e webhook

**Files:** Create `src/integrations/payments/types.ts`, `mercadopago.ts`, `fakeGateway.ts`, `src/domain/payments.ts`, `src/domain/payments.test.ts`, `src/app/api/checkout/pay/route.ts`, `src/app/api/webhooks/mercadopago/[storeId]/route.ts`, `src/app/(loja)/pedido/[id]/page.tsx`, `src/app/api/cron/expire-orders/route.ts`.

**Interfaces:** Produces `interface PaymentGateway { payCard(input:{orderId; amountCents; token; installments; paymentMethodId; payer:{email; cpf}}, idempotencyKey:string): Promise<GatewayResult>; payPix(input:{orderId; amountCents; payer}, idempotencyKey:string): Promise<GatewayResult & {qrCode:string; qrCodeBase64:string; expiresAt:Date}>; getPayment(id:string): Promise<{id:string; status:"approved"|"pending"|"rejected"|"cancelled"|"refunded"; externalReference:string}> }`; `gatewayForStore(storeId): Promise<PaymentGateway>` (credenciais da loja; `FakeGateway` sem credenciais em desenvolvimento); `applyPaymentUpdate(storeId, orderId, status): Promise<void>` (só `PENDING_PAYMENT→PAID|CANCELED`); `verifyWebhookSignature(headers, dataId, secret):boolean` (HMAC-SHA256 do formato `x-signature`).

- [ ] **Step 1:** Testes com `FakeGateway`: `approved`→`PAID`; webhook repetido → uma transição; `rejected`→`CANCELED` com estoque devolvido; `approved` para pedido `CANCELED` → ignora e registra alerta; assinatura inválida → 401 sem tocar no banco; webhook da loja A com `orderId` da loja B → 404; Pix com desconto: `amountCents` = total × (1 − `pixDiscountPercent`/100) arredondado.
- [ ] **Step 2:** Implementar. Cartão: Card Payment Brick gera o token, servidor chama `payCard`. Pix: `payPix`, QR e `pixExpiresAt` (30 min). `X-Idempotency-Key = order:<id>:<tentativa>`. Webhook consulta `getPayment` (não confia no corpo) e usa `externalReference` como `orderId`.
- [ ] **Step 3:** Cron expira Pix vencidos chamando `cancelOrder` (`CRON_SECRET`, a cada 5 min). Página `/pedido/[id]` com QR, copia-e-cola e polling de 5 s. Commit `feat: store payments`.

### Task 17: Conta do comprador

**Files:** Create `src/app/(loja)/conta/**`.

- [ ] **Step 1:** Pedidos próprios, detalhe com rastreio, CRUD de endereços; consultas sempre por `session.id` e `storeId`.
- [ ] **Step 2:** Testes: cliente A pedindo pedido de B (mesma loja) → 404; cliente de outra loja → 404. Commit `feat: customer account`.

### Task 18: Admin da loja: pedidos e clientes

**Files:** Create `src/app/admin/pedidos/**`, `src/app/admin/clientes/**`, `src/app/api/admin/orders/[id]/route.ts`.

**Interfaces:** `PATCH /api/admin/orders/[id]` `{status?:"SHIPPED"|"DELIVERED"|"CANCELED"; trackingCode?:string}`; só `PAID→SHIPPED→DELIVERED`; cancelar chama `cancelOrder`.

- [ ] **Step 1:** Listas com filtros (status/data/busca), detalhe, clientes com total gasto e nº de pedidos; escrita bloqueada se loja suspensa.
- [ ] **Step 2:** Teste: `PENDING_PAYMENT→SHIPPED` → 409. Commit `feat: store orders and customers`.

### Task 19: Métricas da loja

**Files:** Create `src/app/admin/page.tsx`, `src/domain/metrics.ts`, `src/domain/metrics.test.ts`, `src/app/api/admin/export/route.ts`.

**Interfaces:** Produces `computeMetrics(orders:OrderRow[], range:{from:Date; to:Date}): {revenueCents; orderCount; avgTicketCents; topProducts:{name;qty}[]; byDay:{date;revenueCents}[]}` (só `PAID|SHIPPED|DELIVERED`); exportação CSV exige `getFeatures().csvExport`; gráfico por dia e top produtos exigem `advancedMetrics` (Start vê só receita, pedidos e ticket médio).

- [ ] **Step 1:** Testes: `CANCELED`/`PENDING_PAYMENT` fora; zero pedidos → ticket médio `0`; `topProducts` por quantidade; plano Start recebe 403 no CSV.
- [ ] **Step 2:** Implementar, passar; seletor 7/30/90 dias. Commit `feat: store metrics`.

### Task 20: Publicação e ponta a ponta

**Files:** Create `vercel.json` (crons: billing/hora, expire-orders/5 min), `README.md`, `e2e/saas.spec.ts`.

- [ ] **Step 1:** README lista variáveis: `DATABASE_URL`, `AUTH_SECRET`, `PLATFORM_DOMAIN`, `CREDENTIALS_KEY`, `BLOB_READ_WRITE_TOKEN`, `BILLING_MP_ACCESS_TOKEN`, `BILLING_WEBHOOK_SECRET`, `CRON_SECRET`, `SEED_MASTER_EMAIL`, `SEED_MASTER_PASSWORD`, `VERCEL_API_TOKEN`.
- [ ] **Step 2:** E2E (Playwright, gateways falsos): lojista se cadastra → loja criada em teste → cadastra categoria e produto com variações → visitante abre `slug.<domínio>`, adiciona ao carrinho, é levado ao login, cadastra-se, paga com token `"ok"` → pedido `PAID` no painel; master suspende a loja → vitrine para de vender.
- [ ] **Step 3:** Deploy na Vercel com wildcard de domínio; registrar webhooks. Commit `chore: deploy and e2e`.
