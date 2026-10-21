# Roadmap para producao

Registrado em 2026-10-21. Marque `[x]` ao concluir.

## Desenvolvimento
- [x] Design system (CSS global + tokens) e layout base
- [~] Vitrine (header, grade, cards prontos; refinar produto, carrinho, checkout, conta): header, grade, produto com galeria, carrinho, checkout, conta, pedidos
- [x] Painel do dono (admin) e painel do master (shell e tabelas; refinar formularios)
- [~] Home da plataforma, cadastro, login (feitos); favicon e imagens padrao (falta)
- [~] Teste visual no navegador: feito com Playwright (scripts/screenshot.mjs) em home, vitrine, produto, login, admin (produtos, config, pedidos) e master; faltam checkout, conta, pedido, demais telas do admin e celular do admin
- [x] E-mail transacional: confirmacao de pagamento, recuperacao de senha, convite (SMTP generico)
- [ ] Verificacao de e-mail no cadastro (nao feita: exige decidir se bloqueia login)
- [x] Paginas legais: termos e privacidade (LGPD) — modelos genericos, revisar com advogado
- [x] Upload de imagens sem Vercel Blob (STORAGE=local + UPLOADS_DIR)
- [x] CI (lint, tipos, testes, build) — workflow criado, ainda nao executado no GitHub

## Producao (infra)
- [~] Dominio + DNS curinga + HTTPS: Caddy pronto no compose (`--profile https`) com /api/tls-check; falta o dominio do dono
- [ ] Segredos novos (`AUTH_SECRET`, `CREDENTIALS_KEY`, `CRON_SECRET`) e senha do master
- [x] Cron: servico `cron` no docker compose (5 min / hora), validado na VPS
- [~] Backup do Postgres (servico `backup` diario, validado); faltam logs centralizados e monitoramento
- [ ] Webhooks do Mercado Pago na URL publica

## Do dono (manual)
- [ ] Chaves Mercado Pago (pagamento e cobranca), Melhor Envio, provedor de e-mail
- [ ] Teste real: Pix, cartao, boleto, frete

## Fora de alcance sem conta externa
Nota fiscal, etiqueta de envio real, comissao por venda (OAuth MP), app mobile (PWA possivel).
