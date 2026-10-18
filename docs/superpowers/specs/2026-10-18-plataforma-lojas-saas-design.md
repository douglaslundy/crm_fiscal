# Plataforma SaaS de lojas virtuais de moda: design

Substitui o spec de loja única (`2026-10-18-loja-roupas-design.md`, removido). Referência de estrutura de vitrine: https://katsukazan.com.br/ (loja Nuvemshop; só modelo de organização, sem copiar marca, textos ou imagens). Pesquisa de planos de mercado: Nuvemshop, Loja Integrada, Tray, Yampi, Shopify (valores de blogs de terceiros, divergentes; confirmar nos sites oficiais).

## Intenção

O dono da plataforma (usuário **master**) oferece lojas virtuais de roupas e camisetas como assinatura. Lojistas se cadastram sozinhos, ganham 14 dias de teste, escolhem um plano e passam a gerir a própria loja (categorias, produtos com variações, pedidos, clientes, frete, métricas). O master também cria lojas manualmente e gerencia todas.

## Metas

- Cadastro autônomo de lojista, criação automática da loja, teste grátis de 14 dias, assinatura paga por plano.
- Painel master: lojas (criar, editar, suspender, reativar), planos (CRUD), assinaturas, métricas da plataforma.
- Cada loja: vitrine pública, carrinho sem login, login só no checkout, painel completo, frete por CEP, pagamento por **Mercado Pago checkout transparente** com as credenciais do próprio lojista.
- Isolamento total de dados entre lojas.

## Não metas (v1)

- Cupons, coleções temáticas, captação de e-mail, avaliações, wishlist, marketplace, nota fiscal, etiqueta de envio, boleto, app mobile, temas personalizáveis por loja, OAuth do Mercado Pago (v1 usa token colado), cobrança de comissão por venda (campo existe, valor 0).

## Anti-metas

- Qualquer dado de uma loja visível para outra loja, para clientes de outra loja ou para lojistas de outra loja.
- Vender mais do que o estoque; aceitar preço do navegador; pedido pago não registrado (webhook perdido ou duplicado).
- Lojista usar recurso fora do plano (limite de produtos, usuários, domínio, métricas avançadas) sem o servidor barrar.
- Credencial de Mercado Pago ou Melhor Envio exposta em tela, log ou resposta de API.
- `/master/**` ou `/admin/**` acessível sem o papel certo.

## Decisões do dono

- SaaS multi-loja com usuário master; lojistas se cadastram sozinhos e pagam assinatura; master também cria lojas manualmente.
- Planos diferentes; teste de 14 dias.
- Mercado Pago checkout transparente nas vendas das lojas.
- CEP de origem configurável por loja, padrão `37175000`.
- Tecnologia escolhida por mim (simples de manter, eficiente, escalável, moderna).
- Testes são versionados. Ainda não há chave do Mercado Pago (usar gateways falsos até existir).

## Planos (palpite meu, baseado na pesquisa; tudo editável pelo master na tabela `Plan`)

| | Start | Pro | Business |
|---|---|---|---|
| Mensalidade | R$ 49 | R$ 129 | R$ 349 |
| Produtos | 50 | 500 | ilimitado |
| Usuários administradores | 1 | 5 | 15 |
| Endereço | subdomínio | subdomínio + domínio próprio | subdomínio + domínio próprio |
| Métricas | básicas | completas | completas + exportação CSV |
| Comissão por venda | 0% | 0% | 0% |

Limites ficam em colunas de `Plan` (`productLimit` nulo = ilimitado, `staffLimit`, `customDomain`, `advancedMetrics`, `csvExport`, `transactionFeeBps`). Comissão por venda fica 0 na v1 porque cobrar exige split de pagamento (OAuth do Mercado Pago); o campo já existe para quando entrar.

## Decisões minhas (o dono não escolheu)

- Next.js (App Router) + TypeScript, aplicação única: site da plataforma, painel master, painel do lojista e vitrines.
- PostgreSQL gerenciado + Prisma. **Banco único, tabelas com `storeId`.** Acesso por uma extensão do Prisma que injeta `storeId` em toda consulta de tabela de loja; teste automatizado prova que uma loja não lê dados de outra.
- Resolução da loja pelo host: `slug.<domínio da plataforma>` ou domínio próprio cadastrado (plano que permitir). Domínio próprio é registrado pela API de domínios da Vercel (palpite meu).
- Duas populações de login (Auth.js, JWT): **contas da plataforma** (`Account`: master e lojistas, ligadas a lojas por `StoreMember{role OWNER|STAFF}`) e **clientes compradores** (`Customer`, únicos por `(storeId,email)`; conta vale só naquela loja).
- Assinatura da plataforma cobrada pelo Mercado Pago da própria plataforma (assinaturas/`preapproval`); webhook próprio. Estados: `TRIALING`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELED`. Teste não pede cartão (palpite meu). Atraso: 3 dias de tolerância em `PAST_DUE`, depois `SUSPENDED`.
- Loja `SUSPENDED`: vitrine mostra aviso de loja indisponível e não vende; painel do lojista fica só leitura; dados preservados.
- Credenciais Mercado Pago e Melhor Envio de cada loja ficam criptografadas (AES-256-GCM, chave em `CREDENTIALS_KEY`) e nunca voltam em respostas de API (só "configurado: sim/não" e últimos 4 caracteres).
- Webhook de vendas por loja: `/api/webhooks/mercadopago/[storeId]`, validado com o segredo daquela loja.
- Imagens no Vercel Blob em pasta por loja. Hospedagem na Vercel.
- Variação = cor × tamanho (SKU, preço e estoque próprios; SKU único por loja). Valores em centavos. Carrinho no navegador e sempre revalidado no servidor. Estoque reservado ao criar pedido e devolvido em cancelamento, recusa ou expiração (Pix 30 min). CPF obrigatório do comprador.
- Vitrine: cards com preço, preço no Pix (percentual por loja, padrão 0), parcelamento (até 3x sem juros, parcela mínima R$ 90,00), selos "Esgotado"/"Frete grátis", aviso "última peça", JSON-LD `Product`.

## Restrições

LGPD (dados mínimos, senha com hash, nenhum dado de cartão no servidor); segredos só em variáveis de ambiente; responsivo; interface em português do Brasil.

## Fica a cargo do construtor

Visual, biblioteca de UI, estrutura de pastas, retentativas de chamadas externas, textos de interface.

## Pendências que dependem do dono

Nome e logotipo da plataforma; domínio base (para subdomínios); credenciais Mercado Pago da plataforma (assinaturas) e de teste; valores finais dos planos.
