const { Events } = require('discord.js');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild || message.author?.bot) return;
    if (message.partial) return; // conteúdo indisponível

    const content = message.content?.slice(0, 1000) || '[sem conteúdo de texto]';
    await logEvent(
      message.guild,
      '🗑️ Mensagem deletada',
      `**Autor:** ${message.author?.tag ?? 'desconhecido'}\n**Canal:** ${message.channel}\n**Conteúdo:**\n${content}`,
      colors.error
    );
  },
};
