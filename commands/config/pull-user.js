const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { addUserToGuild, isOAuthEnabled } = require('../../oauth/server');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull-user')
    .setDescription('Adiciona ao servidor um usuário que conectou a conta via verificação OAuth')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Usuário a adicionar').setRequired(true)),

  async execute(interaction) {
    if (!isOAuthEnabled()) {
      return interaction.reply({
        embeds: [errorEmbed('OAuth não está configurado no bot (CLIENT_SECRET / OAUTH_REDIRECT_URI ausentes no .env).')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const user = interaction.options.getUser('usuario', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await addUserToGuild(interaction.client, user.id, interaction.guild.id);
    if (!result.ok) {
      return interaction.editReply({ embeds: [errorEmbed(`Não foi possível adicionar **${user.tag}**: ${result.reason}`)] });
    }

    await logEvent(interaction.guild, '➕ Usuário adicionado via OAuth',
      `**Usuário:** ${user.tag} (${user.id})\n**Por:** ${interaction.user.tag}`, colors.info);

    return interaction.editReply({
      embeds: [successEmbed(result.added ? `**${user.tag}** foi adicionado ao servidor.` : `**${user.tag}** já era membro do servidor.`)],
    });
  },
};
