require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');
const { loadEvents } = require('./handlers/loadEvents');

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN não definido. Copie .env.example para .env e preencha.');
  process.exit(1);
}

const client = new Client({
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
