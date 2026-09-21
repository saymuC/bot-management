const { getGuildConfig } = require('../database/db');
const { baseEmbed } = require('./embeds');
const { colors } = require('../config/settings');
const { logError } = require('./observability');

/**
 * Envia um evento para o canal de logs configurado do servidor.
 * Silencioso se não houver canal configurado; loga no console em caso de falha.
 */
async function logEvent(guild, title, description, color = colors.info, fields = []) {
  // Fora do try para o log de erro poder dizer *qual* canal falhou; reconsultar
  // o banco dentro do catch poderia estourar de novo pelo mesmo motivo.
  let channelId;
  try {
    channelId = getGuildConfig(guild.id)?.log_channel_id;
    if (!channelId) return;

    const channel = await guild.client.channels.fetch(channelId).catch(() => null);
    if (channel?.guildId !== guild.id) return;
    if (!channel?.isTextBased()) return;

    await channel.send({ embeds: [baseEmbed({ title, description, color, fields })] });
  } catch (err) {
    logError('logger', err, { guildId: guild?.id, channelId, title });
  }
}

module.exports = { logEvent };
