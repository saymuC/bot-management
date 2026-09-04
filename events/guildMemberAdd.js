const { Events } = require('discord.js');
const { getGuildConfig } = require('../database/db');
const { baseEmbed } = require('../utils/embeds');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');

function formatWelcome(template, member) {
  return template
    .replaceAll('{user}', `${member}`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', String(member.guild.memberCount));
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

    // welcome
    if (config?.welcome_channel_id) {
      const channel = await member.guild.channels.fetch(config.welcome_channel_id).catch(() => null);
      if (channel?.isTextBased()) {
        const message = formatWelcome(
          config.welcome_message || 'Bem-vindo(a) {user} ao **{server}**! Agora somos {membercount} membros. 🎉',
          member
        );
        await channel
          .send({
            embeds: [
              baseEmbed({
                title: '👋 Novo membro!',
                description: message,
                color: colors.success,
                thumbnail: member.user.displayAvatarURL({ size: 256 }),
              }),
            ],
          })
          .catch((err) => console.error('[welcome] Falha:', err.message));
      }
    }

    await logEvent(
      member.guild,
      '📥 Membro entrou',
      `${member.user.tag} (${member.id}) entrou no servidor.`,
      colors.success
    );
  },
};
