# Roadmap para producao

Registrado em 2026-10-21. Marque `[x]` ao concluir.

## Desenvolvimento
- [x] Design system (CSS global + tokens) e layout base
- [~] Vitrine (header, grade, cards prontos; refinar produto, carrinho, checkout, conta): header, grade, produto com galeria, carrinho, checkout, conta, pedidos
- [x] Painel do dono (admin) e painel do master (shell e tabelas; refinar formularios)
- [~] Home da plataforma, cadastro, login (feitos); favicon e imagens padrao (falta)
- [ ] Teste visual no navegador (desktop e celular) de todas as telas
- [ ] E-mail transacional: pedido, recuperacao de senha, verificacao, convite
- [x] Paginas legais: termos e privacidade (LGPD) — modelos genericos, revisar com advogado
- [x] Upload de imagens sem Vercel Blob (STORAGE=local + UPLOADS_DIR)
- [x] CI (lint, tipos, testes, build) — workflow criado, ainda nao executado no GitHub

## Producao (infra)
- [ ] Dominio + DNS curinga (`*.dominio`) + proxy HTTPS (Caddy/Traefik)
- [ ] Segredos novos (`AUTH_SECRET`, `CREDENTIALS_KEY`, `CRON_SECRET`) e senha do master
- [ ] Cron: `/api/cron/expire-orders` e `/api/cron/billing`
- [ ] Backup do Postgres, logs e monitoramento
- [ ] Webhooks do Mercado Pago na URL publica

## Do dono (manual)
- [ ] Chaves Mercado Pago (pagamento e cobranca), Melhor Envio, provedor de e-mail
- [ ] Teste real: Pix, cartao, boleto, frete

## Fora de alcance sem conta externa
Nota fiscal, etiqueta de envio real, comissao por venda (OAuth MP), app mobile (PWA possivel).
