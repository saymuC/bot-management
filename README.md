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
| Tickets | `/ticket-panel` `/ticket-add-category` `/ticket-remove-category` |
| Sorteios | `/giveaway-start` `/giveaway-reroll` |
| Cargos | `/setup-autorole` `/reactionrole-setup` |
| Utilidade | `/say` `/embed` `/nuke` |
| Configuração | `/setup-welcome` `/setup-logs` `/setup-verify` `/pull-user` |

`/nuke confirmar:true` clona o canal atual (nome, tópico, NSFW, slowmode, categoria, posição e todas as permissões), apaga o original e registra a ação nos logs. É irreversível: as mensagens não são recuperáveis.

## Fluxo de tickets

1. `/ticket-add-category label:"Bug" emoji:🐛 categoria:#Tickets cargo:@Suporte` (repita para cada tipo).
2. `/ticket-panel canal:#suporte` publica o painel com o botão **Abrir Ticket**.
3. O usuário escolhe a categoria no dropdown → o bot cria o canal privado com botões **Reivindicar** e **Fechar**.
4. Ao fechar, o bot gera um transcript `.txt` e envia ao canal de logs antes de deletar o canal.

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
