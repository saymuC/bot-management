const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { addUserToGuild, isOAuthEnabled } = require('../../oauth/server');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('pull-user')
    .setDescription('Adiciona ao servidor um usuário que conectou a conta via verificação OAuth')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário a adicionar').setRequired(true)),

  async execute(interaction) {
    if (!isOAuthEnabled()) {
      return respond(interaction, {
        embeds: [errorEmbed('OAuth não está configurado no bot (CLIENT_SECRET / OAUTH_REDIRECT_URI ausentes no .env).')],
      });
    }

    const user = interaction.options.getUser('usuario', true);

    const result = await addUserToGuild(interaction.client, user.id, interaction.guild.id);
    if (!result.ok) {
      return respond(interaction, { embeds: [errorEmbed(`Não foi possível adicionar **${user.tag}**: ${result.reason}`)] });
    }

    await logEvent(interaction.guild, `${emoji(interaction.guild, 'member_add_oauth')} Usuário adicionado via OAuth`,
      `**Usuário:** ${user.tag} (${user.id})\n**Por:** ${interaction.user.tag}`, colors.info);

    return respond(interaction, {
      embeds: [successEmbed(result.added ? `**${user.tag}** foi adicionado ao servidor.` : `**${user.tag}** já era membro do servidor.`)],
    });
  },
};
