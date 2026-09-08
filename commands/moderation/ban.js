const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bane um membro do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a banir').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo do banimento'))
    .addIntegerOption((opt) =>
      opt.setName('apagar_dias').setDescription('Apagar mensagens dos últimos N dias (0-7)').setMinValue(0).setMaxValue(7)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const reason = interaction.options.getString('motivo') ?? 'Não informado';
    const deleteDays = interaction.options.getInteger('apagar_dias') ?? 0;

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      if (!member.bannable) {
        return respond(interaction, { embeds: [errorEmbed('Não consigo banir este membro (hierarquia de cargos).')] });
      }
      if (member.roles.highest.position >= interaction.member.roles.highest.position &&
          interaction.guild.ownerId !== interaction.user.id) {
        return respond(interaction, { embeds: [errorEmbed('Você não pode banir alguém com cargo igual ou superior ao seu.')] });
      }
    }

    await interaction.guild.members.ban(user.id, {
      reason: `${reason} — por ${interaction.user.tag}`,
      deleteMessageSeconds: deleteDays * 86400,
    });

    const icon = emoji(interaction.guild, 'ban');
    await logEvent(interaction.guild, `${icon} Ban aplicado`,
      `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n**Motivo:** ${reason}`, colors.error);

    return respond(interaction, {
      embeds: [successEmbed(`**${user.tag}** foi banido.\n**Motivo:** ${reason}`, `${icon} Banido`)],
    });
  },
};
