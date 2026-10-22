# Roadmap para producao

Registrado em 2026-10-21. Marque `[x]` ao concluir.

## Desenvolvimento
- [x] Design system (CSS global + tokens) e layout base
- [~] Vitrine (header, grade, cards prontos; refinar produto, carrinho, checkout, conta): header, grade, produto com galeria, carrinho, checkout, conta, pedidos
- [x] Painel do dono (admin) e painel do master (shell e tabelas; refinar formularios)
- [~] Home da plataforma, cadastro, login (feitos); favicon e imagens padrao (falta)
- [x] Teste visual no navegador (Playwright, scripts/screenshot*.mjs): vitrine, carrinho, checkout, conta, favoritos, admin e master, inclusive no celular; falta so a tela de um pedido com itens
- [x] E-mail transacional: confirmacao de pagamento, recuperacao de senha, convite (SMTP generico)
- [x] Verificacao de e-mail no cadastro (nao bloqueia login; confirma no clique do botao; reenvio na conta do cliente)
- [x] SEO da loja: robots.txt, sitemap.xml e imagem ao compartilhar produto
- [x] Cota de upload por loja, tls-check interno, container sem root, sessoes invalidadas ao trocar a senha
- [x] Paginas legais: termos e privacidade (LGPD) — modelos genericos, revisar com advogado
- [x] Upload de imagens sem Vercel Blob (STORAGE=local + UPLOADS_DIR)
- [x] CI (lint, tipos, testes, build) — roda a cada push no GitHub

## Producao (infra)
- [~] Dominio + DNS curinga + HTTPS: Caddy pronto no compose (`--profile https`) com /api/tls-check; falta o dominio do dono
- [~] Segredos novos: `node scripts/gen-env.mjs <dominio> <email-master> --write` gera o .env de producao; falta o dono rodar no servidor real
- [x] Cron: servico `cron` no docker compose (5 min / hora), validado na VPS
- [~] Backup do Postgres (servico `backup` diario, validado); faltam logs centralizados e monitoramento
- [ ] Webhooks do Mercado Pago na URL publica

## Do dono (manual)
- [ ] Chaves Mercado Pago (pagamento e cobranca), Melhor Envio, provedor de e-mail
- [ ] Teste real: Pix, cartao, boleto, frete

## Fora de alcance sem conta externa
Nota fiscal, etiqueta de envio real, comissao por venda (OAuth MP), app mobile (PWA possivel).
