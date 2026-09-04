require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./handlers/loadCommands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN e CLIENT_ID são obrigatórios no .env.');
  process.exit(1);
}

const commands = loadCommands({ commands: null });
const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    const data = await rest.put(route, { body: commands });
    console.log(
      `✅ ${data.length} comandos registrados ${GUILD_ID ? `no servidor ${GUILD_ID}` : 'globalmente'}.`
    );
  } catch (err) {
    console.error('Falha ao registrar comandos:', err);
    process.exit(1);
  }
})();
