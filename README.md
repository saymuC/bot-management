# Bot Discord Multifuncional

Bot de gerenciamento com tickets, moderação, sorteios, boas-vindas, logs, self-roles, verificação, emojis configuráveis e controle de status — Node.js + discord.js v14 + SQLite (better-sqlite3).

## Setup

1. Crie a aplicação em https://discord.com/developers/applications, ative os **Privileged Gateway Intents**: `SERVER MEMBERS` e `MESSAGE CONTENT` (este é obrigatório: é como o `/config-emojis` lê o emoji que você manda no chat).
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

São 28 comandos. A coluna **Permissão** é a exigência padrão do Discord para o membro ver e usar o comando (dá para sobrescrever em _Configurações do servidor → Integrações_).

### Moderação

| Comando | O que faz | Permissão |
|---|---|---|
| `/ban usuario motivo apagar_dias` | Bane um membro do servidor | Banir membros |
| `/kick usuario motivo` | Expulsa um membro do servidor | Expulsar membros |
| `/mute usuario duracao motivo` | Silencia um membro (timeout nativo do Discord) | Moderar membros |
| `/warn usuario motivo` | Aplica uma advertência a um membro | Moderar membros |
| `/warnings usuario` | Lista as advertências de um membro | Moderar membros |
| `/clear quantidade` | Apaga mensagens do canal atual | Gerenciar mensagens |

### Tickets

| Comando | O que faz | Permissão |
|---|---|---|
| `/ticket-panel canal titulo descricao` | Publica o painel de abertura de tickets | Administrador |
| `/ticket-add-category label emoji categoria cargo` | Adiciona uma categoria de ticket | Administrador |
| `/ticket-remove-category id` | Remove uma categoria de ticket | Administrador |
| `/ticket-stats pagina` | Ranking dos atendentes: nota média, tickets e TMA | Gerenciar mensagens |

### Sorteios

| Comando | O que faz | Permissão |
|---|---|---|
| `/giveaway-start premio duracao vencedores` | Inicia um sorteio | Gerenciar servidor |
| `/giveaway-end giveaway` | Encerra agora, sorteando e anunciando os vencedores | Gerenciar servidor |
| `/giveaway-stop giveaway` | Cancela um sorteio sem sortear ninguém | Gerenciar servidor |
| `/giveaway-reroll id quantidade` | Sorteia novos vencedores de um sorteio encerrado | Gerenciar servidor |

### Cargos

| Comando | O que faz | Permissão |
|---|---|---|
| `/setup-autorole cargo` | Define o cargo automático para novos membros | Gerenciar cargos |
| `/reactionrole-setup cargo canal mensagem emoji` | Cria uma mensagem de auto-atribuição (botão toggle) | Gerenciar cargos |

### Utilidade

| Comando | O que faz | Permissão |
|---|---|---|
| `/say mensagem canal` | Envia uma mensagem pelo bot | Gerenciar mensagens |
| `/embed titulo descricao canal cor anexo midia_url miniatura miniatura_url rodape` | Cria um embed com pré-visualização antes de enviar (imagem grande + miniatura no canto) | Gerenciar mensagens |
| `/nuke confirmar` | Recria o canal atual do zero (apaga todas as mensagens) | Gerenciar canais |
| `/ping` | Latência do gateway, tempo de resposta e uptime | Todos |

### Configuração

| Comando | O que faz | Permissão |
|---|---|---|
| `/setup-welcome` | Painel das mensagens de boas-vindas | Administrador |
| `/setup-logs canal` | Define o canal de logs do servidor | Administrador |
| `/setup-ticket-logs canal` | Canal de logs exclusivo dos tickets (transcripts e avaliações) | Administrador |
| `/setup-verify canal cargo` | Configura o sistema de verificação de entrada | Administrador |
| `/pull-user usuario` | Readiciona ao servidor quem conectou a conta via OAuth | Administrador |
| `/bot-status` | Painel do status e da atividade do bot (global) | Administrador |
| `/config-emojis` | Painel para trocar os emojis usados pelo bot | Administrador |
| `/emoji-add emoji arquivo nome` | Importa um emoji de outro servidor, de um ID ou de uma imagem | Gerenciar expressões |

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

## Emojis configuráveis

Todo emoji que o bot mostra aos membros vive num registro central (`utils/emojis.js`) e pode ser trocado **por servidor** — 24 chaves em 6 categorias: gerais, tickets, sorteios, entrada/verificação, moderação e logs.

`/config-emojis` abre o painel. Você escolhe a chave no menu e o bot pede para **mandar o emoji novo ali no chat mesmo** — vale o teclado de emojis do Discord ou um emoji personalizado de qualquer servidor em que o bot esteja. Ele lê a mensagem, apaga e salva na hora. Na conversa também dá para escrever `padrao` para restaurar ou `cancelar` para desistir; a janela é de 60 s.

Só as diferenças em relação ao padrão são gravadas (JSON em `guild_config.emoji_config`), então o painel sempre marca com `✏️` o que foi personalizado e com `·` o que está no padrão. Se um emoji personalizado sair do ar, o painel avisa e o bot volta ao padrão em vez de quebrar a mensagem.

`/emoji-add` importa um emoji para o servidor atual a partir de:

- um emoji personalizado colado de outro servidor (`<:nome:123...>`);
- o ID cru do emoji (o bot descobre sozinho se é animado);
- um link `https://` de imagem;
- ou um anexo (`png`, `jpg`, `gif`, `webp`).

O download é validado antes de ir para a API: só `https`, endereços internos bloqueados, redirecionamentos reconferidos e o limite de **256 KB** do Discord aplicado. O comando também confere as vagas de emoji do servidor (estáticas e animadas contam separado) e responde com o motivo em português quando a API recusa.

## Status do bot

`/bot-status` abre um painel com rascunho: você monta o status, vê o preview e só então confirma. É uma configuração **global** (vale para o bot inteiro, não por servidor) e fica salva no banco, então sobrevive a reinícios.

Dá para escolher a bolinha (online, ausente, não perturbe, invisível) e o tipo de atividade: nenhuma, personalizado, jogando, assistindo, ouvindo, competindo em e **transmitindo** — este último deixa o bot roxo e o título clicável, mas o Discord exige uma URL de Twitch ou YouTube (qualquer outro domínio é ignorado, inclusive `discord.gg`).

O status é aplicado de forma redundante porque o gateway o zera em cada reconexão: ele vai dentro do IDENTIFY (nasce certo em todo login) e é reconferido nos eventos de reconexão. A conferência é "olha antes de agir" — se o status já está correto, nada é enviado; se divergir, o bot corrige e confere de novo, até 3 tentativas. Não há verificação periódica em segundo plano.

> Reler o status real depende da intent privilegiada `GuildPresences`, que este bot não usa. Sem ela o status é aplicado sem conferência (o que basta, já que ele também vai no IDENTIFY).

## Verificação com OAuth (opcional)

O botão **Verificar** dá o cargo configurado em `/setup-verify`. Se você preencher `CLIENT_SECRET`, `OAUTH_REDIRECT_URI` e `OAUTH_PORT` no `.env` (e cadastrar a Redirect URL na aba OAuth2 do Developer Portal), após verificar o usuário também recebe um botão opcional **Conectar conta** (escopos `identify guilds.join`, com consentimento explícito na tela oficial do Discord). Usuários conectados podem ser readicionados ao servidor pela staff com `/pull-user`.

> O servidor de callback roda em `http://localhost:PORTA/callback`. Para uso real, exponha com um domínio/HTTPS (ex: reverse proxy) e atualize a Redirect URL.

## Placeholders de boas-vindas

`{user}` menção · `{username}` nome · `{server}` nome do servidor · `{membercount}` total de membros.

## Estrutura

- `index.js` — entrypoint (monta o client já com a presença salva) · `deploy-commands.js` — registro de slash commands
- `database/db.js` — schema SQLite e helpers de config
- `handlers/` — loaders e a lógica dos painéis: tickets, giveaways, embed, boas-vindas, status e emojis
- `events/` — ready, interactionCreate (roteia botões/selects por prefixo do customId), member add/remove, logs
- `commands/<módulo>/` — um arquivo por comando
- `utils/emojis.js` — registro central dos emojis · `utils/emojiSource.js` — download validado do `/emoji-add`
- `utils/presence.js` — presença salva e normalizada · `utils/presenceKeeper.js` — garante o status após reconexões
- `oauth/server.js` — callback OAuth2 (verify avançado)
