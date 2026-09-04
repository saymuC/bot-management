const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const ms = require('ms');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // limite do Discord: 28 dias

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Silencia um membro (timeout nativo do Discord)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a silenciar').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('duracao').setDescription('Duração (ex: 10m, 1h, 2d). Máx 28d').setRequired(true)
    )
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo do mute')),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const durationRaw = interaction.options.getString('duracao', true);
    const reason = interaction.options.getString('motivo') ?? 'Não informado';

    const duration = ms(durationRaw);
    if (!duration || duration < 5000 || duration > MAX_TIMEOUT_MS) {
      return interaction.reply({
        embeds: [errorEmbed('Duração inválida. Use algo entre `5s` e `28d` (ex: `10m`, `1h`, `2d`).')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return interaction.reply({ embeds: [errorEmbed('Este usuário não está no servidor.')], flags: MessageFlags.Ephemeral });
    }
    if (!member.moderatable) {
      return interaction.reply({ embeds: [errorEmbed('Não consigo silenciar este membro (hierarquia de cargos).')], flags: MessageFlags.Ephemeral });
    }

    await member.timeout(duration, `${reason} — por ${interaction.user.tag}`);

    await logEvent(interaction.guild, '🔇 Mute aplicado',
      `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n**Duração:** ${durationRaw}\n**Motivo:** ${reason}`,
      colors.warning);

    return interaction.reply({
      embeds: [successEmbed(`**${user.tag}** silenciado por **${durationRaw}**.\n**Motivo:** ${reason}`, '🔇 Silenciado')],
    });
  },
};
