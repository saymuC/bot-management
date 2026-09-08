const { Events } = require('discord.js');
const { getGuildConfig } = require('../database/db');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');
const { getWelcomeConfig, buildWelcomeMessage } = require('../utils/welcomeConfig');

/** Envia a mensagem de boas-vindas conforme o painel do /setup-welcome. */
async function sendWelcome(member) {
  const config = getWelcomeConfig(member.guild.id);
  if (!config.enabled || !config.channelId) return;

  const channel = await member.guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel
    .send(buildWelcomeMessage(config, member))
    .catch((err) => console.error('[welcome] Falha:', err.message));
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const config = getGuildConfig(member.guild.id);

    // autorole
    if (config?.autorole_id) {
      await member.roles
        .add(config.autorole_id, 'Autorole configurado')
        .catch((err) => console.error('[autorole] Falha:', err.message));
    }

    await sendWelcome(member);

    await logEvent(
      member.guild,
      '📥 Membro entrou',
      `${member.user.tag} (${member.id}) entrou no servidor.`,
      colors.success
    );
  },
};
