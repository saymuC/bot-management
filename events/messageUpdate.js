const { Events } = require('discord.js');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.partial || oldMessage.content === newMessage.content) return;

    await logEvent(
      newMessage.guild,
      '✏️ Mensagem editada',
      [
        `**Autor:** ${newMessage.author.tag}`,
        `**Canal:** ${newMessage.channel} — [ir para mensagem](${newMessage.url})`,
        `**Antes:**\n${(oldMessage.content || '[vazio]').slice(0, 800)}`,
        `**Depois:**\n${(newMessage.content || '[vazio]').slice(0, 800)}`,
      ].join('\n'),
      colors.warning
    );
  },
};
