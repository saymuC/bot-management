const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const ms = require('ms');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // limite do Discord: 28 dias

module.exports = {
  ephemeral: false,
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
      return respond(interaction, {
        embeds: [errorEmbed('Duração inválida. Use algo entre `5s` e `28d` (ex: `10m`, `1h`, `2d`).')],
      });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return respond(interaction, { embeds: [errorEmbed('Este usuário não está no servidor.')] });
    }
    if (!member.moderatable) {
      return respond(interaction, { embeds: [errorEmbed('Não consigo silenciar este membro (hierarquia de cargos).')] });
    }

    await member.timeout(duration, `${reason} — por ${interaction.user.tag}`);

    const icon = emoji(interaction.guild, 'mute');
    await logEvent(interaction.guild, `${icon} Mute aplicado`,
      `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n**Duração:** ${durationRaw}\n**Motivo:** ${reason}`,
      colors.warning);

    return respond(interaction, {
      embeds: [successEmbed(`**${user.tag}** silenciado por **${durationRaw}**.\n**Motivo:** ${reason}`, `${icon} Silenciado`)],
    });
  },
};
