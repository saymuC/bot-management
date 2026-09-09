const { Events } = require('discord.js');
const { startGiveawaySweeper } = require('../handlers/giveawayHandler');
const { startPresenceKeeper } = require('../utils/presenceKeeper');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Logado como ${client.user.tag} em ${client.guilds.cache.size} servidor(es).`);

    // O gateway zera a presença a cada conexão (inclusive nas reconexões
    // automáticas), então quem cuida disso é o guardião, não uma chamada única.
    startPresenceKeeper(client);

    startGiveawaySweeper(client);
  },
};
