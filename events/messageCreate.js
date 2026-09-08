const { Events } = require('discord.js');
const { handleBotMention } = require('../handlers/mentionHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    await handleBotMention(message, client);
  },
};
