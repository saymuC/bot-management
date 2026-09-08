const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');

module.exports = {
  ephemeral: false,
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
      return respond(interaction, { embeds: [errorEmbed('Este usuário não está no servidor.')] });
    }
    if (!member.kickable) {
      return respond(interaction, { embeds: [errorEmbed('Não consigo expulsar este membro (hierarquia de cargos).')] });
    }

    await member.kick(`${reason} — por ${interaction.user.tag}`);

    const icon = emoji(interaction.guild, 'kick');
    await logEvent(interaction.guild, `${icon} Kick aplicado`,
      `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n**Motivo:** ${reason}`, colors.warning);

    return respond(interaction, {
      embeds: [successEmbed(`**${user.tag}** foi expulso.\n**Motivo:** ${reason}`, `${icon} Expulso`)],
    });
  },
};
