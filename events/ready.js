const { Events } = require('discord.js');
const { startGiveawaySweeper } = require('../handlers/giveawayHandler');
const { getSavedPresence, applyPresence, describePresence } = require('../utils/presence');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Logado como ${client.user.tag} em ${client.guilds.cache.size} servidor(es).`);

    // O gateway zera a presença a cada conexão, então reaplicamos o que o
    // /bot-status gravou (ou o padrão, na primeira execução).
    const presence = applyPresence(client, getSavedPresence());
    console.log(`[presence] ${describePresence(presence)}`);

    startGiveawaySweeper(client);
  },
};
