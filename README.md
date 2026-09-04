# bot-management
Bot completo.

# Bot Discord Multifuncional

Bot de gerenciamento com tickets, moderação, sorteios, boas-vindas, logs, self-roles e verificação — Node.js + discord.js v14 + SQLite (better-sqlite3).

## Setup

1. Crie a aplicação em https://discord.com/developers/applications, ative os **Privileged Gateway Intents**: `SERVER MEMBERS` e `MESSAGE CONTENT`.
2. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN`, `CLIENT_ID` e (opcional) `GUILD_ID` para testes.
3. Registre os comandos e inicie:

```bash
npm run deploy
```

```bash
npm start
```

Convide o bot com o scope `bot applications.commands` e permissão de Administrador (ou as permissões mínimas: Manage Channels, Manage Roles, Ban/Kick/Moderate Members, Manage Messages, Create Invite).

## Comandos

| Módulo | Comandos |
|---|---|
| Moderação | `/ban` `/kick` `/mute` `/warn` `/warnings` `/clear` |
| Tickets | `/ticket-panel` `/ticket-add-category` `/ticket-remove-category` `/ticket-stats` |
| Sorteios | `/giveaway-start` `/giveaway-end` `/giveaway-stop` `/giveaway-reroll` |
| Cargos | `/setup-autorole` `/reactionrole-setup` |
| Utilidade | `/say` `/embed` `/nuke` |
| Configuração | `/setup-welcome` `/setup-logs` `/setup-ticket-logs` `/setup-verify` `/pull-user` |

`/nuke confirmar:true` clona o canal atual (nome, tópico, NSFW, slowmode, categoria, posição e todas as permissões), apaga o original e registra a ação nos logs. É irreversível: as mensagens não são recuperáveis.

## Sorteios

`/giveaway-start premio:"Nitro" duracao:1h vencedores:1` publica o sorteio com o botão **🎉 Participar**. Ao vencer o prazo, uma varredura periódica encerra e anuncia automaticamente.

Para agir antes do prazo, `/giveaway-end` e `/giveaway-stop` têm autocomplete: ao digitar, o Discord lista os sorteios **em andamento** do servidor no formato `#id — prêmio (N participantes)`.

- `/giveaway-end giveaway:<sorteio>` — encerra na hora: sorteia, edita a mensagem original e anuncia o(s) vencedor(es) no canal do sorteio.
- `/giveaway-stop giveaway:<sorteio>` — **cancela** o sorteio. Nenhum vencedor é sorteado nem revelado; a mensagem passa a exibir o aviso de cancelamento, o botão de participação é removido e a ação vai para o canal de logs. Um sorteio cancelado não pode ser encerrado nem sofrer `/giveaway-reroll` depois.

`/giveaway-reroll id:<id> quantidade:<n>` sorteia novos vencedores de um sorteio já encerrado normalmente.

## Fluxo de tickets

1. `/ticket-add-category label:"Bug" emoji:🐛 categoria:#Tickets cargo:@Suporte` (repita para cada tipo).
2. `/setup-ticket-logs canal:#logs-tickets` define onde ficam os registros e transcripts. Sem isso, tudo cai no canal de `/setup-logs`.
3. `/ticket-panel canal:#suporte` publica o painel com o botão **Abrir Ticket**.
4. No clique em **Abrir Ticket** o bot já valida o limite de tickets abertos por usuário (`config/settings.js` → `ticket.maxOpenPerUser`), antes de mostrar as categorias.
5. O usuário escolhe a categoria no dropdown → o bot cria o canal privado com botões **Reivindicar** e **Fechar**.
6. **Reivindicar** é só para a equipe: quem abriu o ticket não pode assumir o próprio atendimento.
7. Ao fechar, o bot registra no canal de logs quem reivindicou, quem fechou, a espera até o primeiro atendimento, o tempo de atendimento e a duração total, junto do **transcript em HTML** (tema escuro, com avatares, embeds e anexos).
8. Em seguida o autor recebe uma DM pedindo a avaliação: 5 botões de ⭐. Ao clicar, abre um formulário com um comentário opcional. A nota fica creditada ao atendente que reivindicou o ticket.

### KPIs de atendimento

`/ticket-stats` lista os atendentes ordenados por nota média, 10 por página, com botões de navegação. Para cada um: nota média e quantidade de avaliações, tickets reivindicados, tickets fechados e **TMA** (tempo médio de atendimento, do momento da reivindicação até o fechamento). O rodapé traz os números do servidor inteiro.

Só existe pedido de avaliação quando o ticket foi reivindicado — sem atendente responsável não há a quem creditar a nota. Cada ticket aceita uma única avaliação.

## Verificação com OAuth (opcional)

O botão **Verificar** dá o cargo configurado em `/setup-verify`. Se você preencher `CLIENT_SECRET`, `OAUTH_REDIRECT_URI` e `OAUTH_PORT` no `.env` (e cadastrar a Redirect URL na aba OAuth2 do Developer Portal), após verificar o usuário também recebe um botão opcional **Conectar conta** (escopos `identify guilds.join`, com consentimento explícito na tela oficial do Discord). Usuários conectados podem ser readicionados ao servidor pela staff com `/pull-user`.

> O servidor de callback roda em `http://localhost:PORTA/callback`. Para uso real, exponha com um domínio/HTTPS (ex: reverse proxy) e atualize a Redirect URL.

## Placeholders de boas-vindas

`{user}` menção · `{username}` nome · `{server}` nome do servidor · `{membercount}` total de membros.

## Estrutura

- `index.js` — entrypoint · `deploy-commands.js` — registro de slash commands
- `database/db.js` — schema SQLite e helpers de config
- `handlers/` — loaders, lógica de tickets e giveaways
- `events/` — ready, interactionCreate (roteia botões/selects por prefixo do customId), member add/remove, logs
- `commands/<módulo>/` — um arquivo por comando
- `oauth/server.js` — callback OAuth2 (verify avançado)
