# Roadmap para producao

Registrado em 2026-10-21. Marque `[x]` ao concluir.

## Desenvolvimento
- [ ] Design system (CSS global + tokens) e layout base
- [ ] Vitrine: header, grade, produto com galeria, carrinho, checkout, conta, pedidos
- [ ] Painel do dono (admin) e painel do master
- [ ] Home da plataforma, cadastro, login; favicon e imagens padrao
- [ ] Teste visual no navegador (desktop e celular) de todas as telas
- [ ] E-mail transacional: pedido, recuperacao de senha, verificacao, convite
- [ ] Paginas legais: termos e privacidade (LGPD)
- [ ] Upload de imagens sem Vercel Blob (disco ou S3)
- [ ] CI (lint, tipos, testes)

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
