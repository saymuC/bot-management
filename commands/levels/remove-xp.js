const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { applyAdminXp } = require('../../utils/levels/adminAction');
const { MAX_TOTAL_XP } = require('../../utils/levels/formula');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('remove-xp')
    .setDescription('Remove XP de um membro (nunca fica negativo)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro que perde o XP').setRequired(true))
    .addIntegerOption((opt) =>
      opt
        .setName('quantidade')
        .setDescription('Quantidade de XP a remover')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_TOTAL_XP)
    ),

  async execute(interaction) {
    return respond(
      interaction,
      await applyAdminXp({
        interaction,
        user: interaction.options.getUser('usuario', true),
        operation: 'remove',
        amount: interaction.options.getInteger('quantidade', true),
      })
    );
  },
};
