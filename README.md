# Trilheiros de Rondonópolis — Reservas e Pagamentos

Sistema de reservas com Mercado Pago e confirmação automática de pagamento.

## O que o sistema faz

- catálogo de passeios e opções;
- valores diferentes para PIX e cartão;
- checkout seguro no Mercado Pago;
- PIX com QR Code / Copia e Cola disponibilizado pelo Mercado Pago;
- cartão de crédito com parcelamento pelo Mercado Pago;
- Webhook validado pelo SDK oficial do Mercado Pago;
- consulta automática do pagamento sem envio de comprovante;
- painel administrativo protegido por senha;
- pesquisa por nome, CPF, telefone, reserva e passeio;
- filtros por status e passeio;
- total recebido, pagamentos aprovados, pessoas confirmadas e pendências;
- exportação CSV.

## Arquitetura

- Frontend: HTML/CSS/JavaScript responsivo.
- Backend: Vercel Functions (`/api`).
- Reservas/pagamentos: Mercado Pago Checkout Pro, Preferences API, Payments API e Webhook.
- Não depende mais de Firebase ou banco externo para operar.

O Mercado Pago é a fonte de verdade. Os dados informados pelo participante ficam associados à preferência de pagamento e o painel consulta preferências e pagamentos diretamente pela API privada no backend.

## Variáveis obrigatórias

Na Vercel:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `APP_URL`

`ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET` são opcionais. Se não forem definidos, o projeto usa o acesso administrativo de bootstrap e assina a sessão com o segredo privado do Webhook, sem expô-lo ao navegador.

## Mercado Pago

1. Abra a aplicação em **Suas integrações**.
2. Configure as credenciais do ambiente usado.
3. Cadastre uma chave PIX na conta para que o PIX apareça no checkout.
4. Em Webhooks, configure `https://SEU-DOMINIO/api/webhook`.
5. Ative o evento **Pagamentos (`payment`)**.
6. Salve a chave secreta em `MERCADOPAGO_WEBHOOK_SECRET`.

O Webhook valida a assinatura oficial e confirma o recebimento. O status exibido ao comprador e no painel é consultado diretamente no Mercado Pago.

## Painel

Acesse `/admin.html`. A sessão é HttpOnly, Secure e SameSite=Strict.

## Passeios e preços

Os passeios ficam em `api/_catalog.js`. O backend calcula os valores a partir desse catálogo; portanto, o navegador não define o preço enviado ao Mercado Pago.

## Deploy

Repositório conectado à Vercel para deploy automático a partir da branch `main`.
