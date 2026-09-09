const { Events } = require('discord.js');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');
const { emoji } = require('../utils/emojis');
const { inspectMessage } = require('../handlers/automodHandler');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return;

    // Mensagem fora do cache chega partial: sem o fetch, `content` vem vazio e o
    // AutoMod deixaria passar exatamente a burla mais simples que existe — mandar
    // "oi" e editar para o link depois.
    const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!message) return;

    // O AutoMod roda mesmo quando o log de edição não tem o "antes" para mostrar.
    // `track: false` porque editar não é mandar de novo: contar a edição no
    // histórico faria o anti-flood punir quem só corrigiu um typo.
    if (await inspectMessage(message, { track: false })) return;

    if (oldMessage.partial || oldMessage.content === message.content) return;

    await logEvent(
      message.guild,
      `${emoji(message.guild, 'message_edit')} Mensagem editada`,
      [
        `**Autor:** ${message.author.tag}`,
        `**Canal:** ${message.channel} — [ir para mensagem](${message.url})`,
        `**Antes:**\n${(oldMessage.content || '[vazio]').slice(0, 800)}`,
        `**Depois:**\n${(message.content || '[vazio]').slice(0, 800)}`,
      ].join('\n'),
      colors.warning
    );
  },
};
