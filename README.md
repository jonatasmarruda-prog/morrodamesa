# Trilheiros de Rondonópolis — Reservas e Pagamentos

Sistema de reservas com Mercado Pago e confirmação automática de pagamento.

## O que o sistema faz

- catálogo de passeios e opções;
- valores diferentes para PIX e cartão;
- checkout seguro no Mercado Pago;
- PIX com QR Code / Copia e Cola disponibilizado pelo Mercado Pago;
- cartão de crédito com parcelamento pelo Mercado Pago;
- webhook para atualizar o status sem envio de comprovante;
- reconciliação do pagamento no retorno do comprador;
- painel administrativo protegido por senha;
- pesquisa por nome, CPF, telefone, reserva e passeio;
- filtros por status e passeio;
- total recebido, pagamentos aprovados, pessoas confirmadas e pendências;
- exportação CSV.

## Arquitetura

- Frontend: HTML/CSS/JavaScript responsivo.
- Backend: Vercel Functions (`/api`).
- Banco: Firebase Firestore via Firebase Admin SDK.
- Pagamentos: Mercado Pago Checkout Pro + Webhook.

> GitHub Pages sozinho não executa as funções de backend. Para pagamentos automáticos, publique o repositório na Vercel ou outro ambiente Node compatível.

## Variáveis de ambiente

Copie `.env.example` e configure no ambiente de hospedagem:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `APP_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

Nunca coloque o Access Token do Mercado Pago ou a chave privada do Firebase em arquivos públicos ou no GitHub.

## Mercado Pago

1. Crie/abra uma aplicação em **Suas integrações**.
2. Configure o Checkout Pro e as credenciais de produção.
3. Cadastre uma chave PIX na conta para que o PIX apareça no checkout.
4. Em Webhooks, configure a URL de produção como `https://SEU-DOMINIO/api/webhook`.
5. Ative o evento **Pagamentos (`payment`)**.
6. Copie a assinatura secreta do Webhook para `MERCADOPAGO_WEBHOOK_SECRET`.

O backend valida a assinatura `x-signature`, consulta o pagamento diretamente na API do Mercado Pago e só confirma a reserva após conferir o status e o valor.

## Firebase

Ative o Firestore e crie uma Service Account. Informe as credenciais somente nas variáveis de ambiente da hospedagem. As reservas ficam na coleção `reservations` e não são lidas diretamente pelo navegador.

## Painel

Acesse `/admin.html`. O login usa `ADMIN_PASSWORD` e cria uma sessão HttpOnly assinada com `ADMIN_SESSION_SECRET`.

## Passeios e preços

Os passeios ficam em `api/_catalog.js`. O backend calcula os valores a partir desse catálogo; portanto, o navegador não consegue alterar o preço enviado ao Mercado Pago.

## Deploy

Repositório conectado à Vercel para deploy automático a partir da branch `main`.
