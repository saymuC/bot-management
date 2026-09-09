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

const client = new Client({
  presence: buildPresenceData(savedPresence),
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

loadCommands(client);
loadEvents(client);

const { startOAuthServer, isOAuthEnabled } = require('./oauth/server');
if (isOAuthEnabled()) {
  startOAuthServer(client);
} else {
  console.log('[oauth] Desativado (defina CLIENT_SECRET e OAUTH_REDIRECT_URI no .env para habilitar).');
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(process.env.DISCORD_TOKEN);
