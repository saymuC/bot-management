const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulsa um membro do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a expulsar').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da expulsão')),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const reason = interaction.options.getString('motivo') ?? 'Não informado';

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Este usuário não está no servidor.')], flags: MessageFlags.Ephemeral });
    }
    if (!member.kickable) {
      return interaction.reply({ embeds: [errorEmbed('Não consigo expulsar este membro (hierarquia de cargos).')], flags: MessageFlags.Ephemeral });
    }

    await member.kick(`${reason} — por ${interaction.user.tag}`);

    await logEvent(interaction.guild, '👢 Kick aplicado',
      `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n**Motivo:** ${reason}`, colors.warning);

    return interaction.reply({ embeds: [successEmbed(`**${user.tag}** foi expulso.\n**Motivo:** ${reason}`, '👢 Expulso')] });
  },
};
