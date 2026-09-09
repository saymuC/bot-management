require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
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

// Ligar `PRESENCE INTENT` no portal não basta: a intent também precisa ser pedida
// aqui, senão o Discord não manda presença nenhuma e o bot não consegue reler o
// próprio status — é o que fazia o guardião reaplicar às cegas a cada reconexão.
// Pedir uma intent privilegiada que esteja desligada no portal derruba o login,
// então dá para desligar por aqui sem editar código.
const wantsPresenceIntent = process.env.PRESENCE_INTENT !== 'false';

const client = new Client({
  presence: buildPresenceData(savedPresence),
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
    ...(wantsPresenceIntent ? [GatewayIntentBits.GuildPresences] : []),
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

loadCommands(client);
loadEvents(client);

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

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

// Sem o catch, uma intent privilegiada desligada no portal só aparece como
// "unhandledRejection" — o motivo real fica escondido no meio do stack.
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  if (/disallowed intents/i.test(err?.message ?? '')) {
    console.error(
      '[login] O Discord recusou uma intent privilegiada. Ligue `SERVER MEMBERS`, `MESSAGE CONTENT` e ' +
        '`PRESENCE INTENT` em https://discord.com/developers/applications → sua aplicação → Bot → ' +
        'Privileged Gateway Intents. Se preferir não usar a de presença, ponha `PRESENCE_INTENT=false` no .env.'
    );
    process.exit(1);
  }

  console.error('[login] Falha ao conectar:', err?.message ?? err);
  process.exit(1);
});
