require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Options } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { loadEvents } = require('./handlers/loadEvents');
const { getSavedPresence, buildPresenceData, describePresence } = require('./utils/presence');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN não definido. Copie .env.example para .env e preencha.');
  process.exit(1);
}

// A presença vai já no IDENTIFY: assim o bot nasce com o status certo, sem
// depender de um OP 3 enviado depois do READY (que o Discord às vezes descarta).
// Vale para toda reconexão que reidentifica, não só para o primeiro login.
const savedPresence = getSavedPresence();
console.log(`[presence] Conectando com: ${describePresence(savedPresence)}`);

const client = new Client({
  presence: buildPresenceData(savedPresence),
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    // `GuildPresences` não entra: nada aqui lê presença de ninguém, e a intent
    // faria o discord.js guardar a presença de todo membro de todo servidor num
    // cache que nem os sweepers abaixo alcançam.
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
  // A intent `GuildMembers` faz o discord.js guardar todo membro que ele vê, e nada
  // tira esse membro do cache: em vários servidores movimentados a memória só sobe
  // até o host matar o processo. Nada no bot depende de cache de membro quente —
  // quem precisa de um membro faz `members.fetch(id)`, e o ranking já busca em lote
  // os que faltam (handlers/levelsLeaderboardHandler.js) — então dá para varrer.
  //
  // O bot é a única exceção obrigatória: `guild.members.me` só lê o cache, e sem ele
  // toda checagem de permissão de canal passa a devolver nulo.
  //
  // ponytail: varre todos os membros de meia em meia hora em vez de olhar atividade;
  // GuildMember não tem "visto por último" (`joinedTimestamp` é data de entrada, não
  // uso). Se o custo de refetch aparecer, trocar por um LRU em `makeCache`.
  sweepers: {
    ...Options.DefaultSweeperSettings,
    members: {
      interval: 1800,
      filter: () => (member) => member.id !== member.client.user.id,
    },
    // `client.users.cache` é global e cresce igual, pelo mesmo motivo.
    users: {
      interval: 3600,
      filter: () => (user) => user.id !== user.client.user.id,
    },
  },
});

loadCommands(client);
loadEvents(client);

// Qual arquivo de banco o processo abriu, dito no boot: em host que publica por
// upload é a única forma de saber, sem adivinhar, se o deploy continuou lendo o
// banco de produção ou se passou a escrever num arquivo novo (dados "sumidos").
const { databaseFile } = require('./database/db');
console.log(`[db] Banco em ${databaseFile}`);

// O captcha da verificação depende de uma fonte do sistema. Avisar no boot evita
// descobrir isso só quando alguém tenta se verificar.
const { checkCaptchaSupport } = require('./utils/captcha');
const captchaSupport = checkCaptchaSupport();
if (captchaSupport.ok) {
  console.log(`[verify] Captcha pronto (fonte: ${captchaSupport.family}).`);
} else {
  console.warn(`[verify] Captcha indisponível — ${captchaSupport.reason}`);
}

const { startOAuthServer, isOAuthEnabled } = require('./oauth/server');
if (isOAuthEnabled()) {
  startOAuthServer(client);
} else {
  console.log('[oauth] Desativado (defina CLIENT_SECRET e OAUTH_REDIRECT_URI no .env para habilitar).');
}

const { startHealthServer } = require('./utils/healthServer');
if (!startHealthServer(client)) {
  console.log('[health] Endpoint HTTP desligado (defina HEALTH_PORT no .env). O comando /health continua valendo.');
}

const { logError } = require('./utils/observability');

process.on('unhandledRejection', (err) => logError('unhandledRejection', err));

// Sem este handler o Node imprime a stack e mata o processo sem passar pelo
// contador do /health — o reinício apagaria a única pista do que derrubou o bot.
// Ele **não** tenta seguir em frente: depois de uma exceção não tratada o estado
// do processo é desconhecido, então logar e sair é o que resta.
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err, { fatal: true });
  process.exit(1);
});

// Sem o catch, uma intent privilegiada desligada no portal só aparece como
// "unhandledRejection" — o motivo real fica escondido no meio do stack.
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  if (/disallowed intents/i.test(err?.message ?? '')) {
    console.error(
      '[login] O Discord recusou uma intent privilegiada. Ligue `SERVER MEMBERS` e `MESSAGE CONTENT` em ' +
        'https://discord.com/developers/applications → sua aplicação → Bot → Privileged Gateway Intents.'
    );
    process.exit(1);
  }

  console.error('[login] Falha ao conectar:', err?.message ?? err);
  process.exit(1);
});
