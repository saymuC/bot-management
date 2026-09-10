const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');
const { getUserState } = require('../../utils/levels/service');
const { resetConfirmComponents } = require('../../handlers/levelsSetupHandler');
const { formatXp } = require('../../utils/levels/leaderboard');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('reset-xp')
    .setDescription('Zera o XP de um membro (pede confirmação)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a zerar').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);

    if (user.bot) {
      return respond(interaction, { embeds: [errorEmbed('Bots não participam do sistema de níveis.')] });
    }

    const state = getUserState(interaction.guild.id, user.id);

    if (state.totalXp === 0) {
      return respond(interaction, {
        embeds: [errorEmbed(`**${user.tag}** já está com 0 XP — não há nada para zerar.`)],
      });
    }

    // Confirmação porque o progresso não tem volta: não há histórico de XP para
    // reconstruir o valor anterior depois do reset.
    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: '♻️ Confirmar reset de XP',
          description:
            `Isso apaga o progresso de **${user.tag}** de forma permanente.\n\n` +
            `**XP atual:** ${formatXp(state.totalXp)}\n**Nível atual:** ${state.level}\n\n` +
            'Os cargos de recompensa que ele tiver pelo sistema de níveis serão retirados.',
          color: colors.warning,
        }),
      ],
      components: resetConfirmComponents(user.id),
    });
  },
};
