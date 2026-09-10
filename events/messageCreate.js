const { Events } = require('discord.js');
const { handleBotMention } = require('../handlers/mentionHandler');
const { inspectMessage } = require('../handlers/automodHandler');
const { handleMessageForLevels } = require('../handlers/levelsHandler');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    // AutoMod primeiro, e o retorno dele é o que decide — não `message.deleted`.
    // Apagar pode falhar por permissão mesmo tendo havido infração, e nesse caso a
    // mensagem continua no canal: premiar com XP quem acabou de ser punido seria o
    // oposto do que o filtro acabou de fazer.
    if (await inspectMessage(message)) return;

    await handleMessageForLevels(message);
    await handleBotMention(message, client);
  },
};
