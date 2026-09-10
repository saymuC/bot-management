const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { applyAdminXp } = require('../../utils/levels/adminAction');
const { MAX_LEVEL } = require('../../utils/levels/formula');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('set-level')
    .setDescription('Define o nível de um membro (o XP passa para o mínimo desse nível)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a ajustar').setRequired(true))
    .addIntegerOption((opt) =>
      opt
        .setName('nivel')
        .setDescription('Nível desejado')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(MAX_LEVEL)
    ),

  async execute(interaction) {
    return respond(
      interaction,
      await applyAdminXp({
        interaction,
        user: interaction.options.getUser('usuario', true),
        operation: 'set',
        amount: interaction.options.getInteger('nivel', true),
      })
    );
  },
};
