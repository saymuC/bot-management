const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Apaga mensagens do canal atual')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt.setName('quantidade').setDescription('Quantidade (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('quantidade', true);

    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) {
      return respond(interaction, {
        embeds: [errorEmbed('Falha ao apagar. Mensagens com mais de 14 dias não podem ser apagadas em massa.')],
      });
    }

    const icon = emoji(interaction.guild, 'clear');
    await logEvent(interaction.guild, `${icon} Mensagens apagadas`,
      `**Canal:** ${interaction.channel}\n**Quantidade:** ${deleted.size}\n**Moderador:** ${interaction.user.tag}`,
      colors.info);

    return respond(interaction, {
      embeds: [successEmbed(`${deleted.size} mensagens apagadas.`, `${icon} Limpeza concluída`)],
    });
  },
};
