# Trilha Outubro Rosa — GitHub Pages

Site público: `/outubro-rosa/`

## Estrutura
- `index.html`: landing page, inscrição, cálculo, Pix, cartão, WhatsApp, contador e painel.
- `backend/Code.gs`: backend Google Apps Script usando a planilha oficial.
- Planilha: https://docs.google.com/spreadsheets/d/1EwRf2UagY_qu7mJ0bbX2RxUbCLqOjZ_jXrO2lh0IZlY/edit?usp=sharing

## Ativação do backend (uma única vez)
1. Abra a planilha oficial.
2. Extensões > Apps Script.
3. Cole o conteúdo de `backend/Code.gs`.
4. Em Configurações do projeto > Propriedades do script, crie:
   - `ADMIN_PASSWORD` = senha escolhida pelo administrador.
   - opcional: `RESERVATION_TTL_MINUTES` = 60.
5. Implantar > Nova implantação > Aplicativo da Web.
6. Executar como: você.
7. Quem tem acesso: qualquer pessoa.
8. Copie a URL terminada em `/exec`.
9. No `index.html`, substitua `PASTE_APPS_SCRIPT_WEBAPP_URL_HERE` pela URL.
10. Commit/push no branch main.

O workflow do repositório já publica o conteúdo no GitHub Pages.

## Regras implementadas
- 100 vagas totais.
- 1 a 10 participantes por reserva.
- Entrada: R$ 30/pessoa.
- Entrada + camiseta: R$ 75/pessoa.
- Camiseta Tradicional ou Babylook, PP a GG.
- Pedido misto.
- Reserva temporária configurável (padrão: 60 minutos).
- Pix oculto com botão copiar.
- WhatsApp: 55 66 99692-6174.
- Cartão: 2 entradas R$ 60 e 2 com camiseta R$ 150.
- Engrenagem administrativa no rodapé.
- Cancelamento devolve vagas e cancela camiseta.
- Dados gravados em abas novas: OR_Reservas, OR_Participantes, OR_Camisetas.
- Nenhuma aba existente da planilha é apagada ou sobrescrita.
