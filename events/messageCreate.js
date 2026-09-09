const { Events } = require('discord.js');
const { handleBotMention } = require('../handlers/mentionHandler');
const { inspectMessage } = require('../handlers/automodHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    // AutoMod primeiro: mensagem apagada não deve render resposta de menção ao bot.
    if (await inspectMessage(message)) return;

    await handleBotMention(message, client);
  },
};
