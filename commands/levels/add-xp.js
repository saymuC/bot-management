const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { applyAdminXp } = require('../../utils/levels/adminAction');
const { MAX_TOTAL_XP } = require('../../utils/levels/formula');

module.exports = {
  ephemeral: false,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'levels',
  requiredPermission: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName('add-xp')
    .setDescription('Adiciona XP a um membro')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro que recebe o XP').setRequired(true))
    .addIntegerOption((opt) =>
      opt
        .setName('quantidade')
        .setDescription('Quantidade de XP a adicionar')
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
        operation: 'add',
        amount: interaction.options.getInteger('quantidade', true),
      })
    );
  },
};
