const { Events, ActivityType } = require('discord.js');
const { startGiveawaySweeper } = require('../handlers/giveawayHandler');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Logado como ${client.user.tag} em ${client.guilds.cache.size} servidor(es).`);
    client.user.setActivity('o servidor 👀', { type: ActivityType.Watching });
    startGiveawaySweeper(client);
  },
};
