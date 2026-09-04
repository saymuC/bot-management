const { getGuildConfig } = require('../database/db');
const { baseEmbed } = require('./embeds');
const { colors } = require('../config/settings');

/**
 * Envia um evento para o canal de logs configurado do servidor.
 * Silencioso se não houver canal configurado; loga no console em caso de falha.
 */
async function logEvent(guild, title, description, color = colors.info, fields = []) {
  try {
    const config = getGuildConfig(guild.id);
    if (!config?.log_channel_id) return;

    const channel = await guild.channels.fetch(config.log_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel.send({ embeds: [baseEmbed({ title, description, color, fields })] });
  } catch (err) {
    console.error(`[logger] Falha ao enviar log no servidor ${guild?.id}:`, err.message);
  }
}

module.exports = { logEvent };
