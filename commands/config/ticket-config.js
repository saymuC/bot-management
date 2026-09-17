const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { homeFor } = require('../../handlers/ticketSetupHandler');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'tickets',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('ticket-config')
    .setDescription('Abre o painel de configuração do sistema de tickets')
    .setDMPermission(false),

  async execute(interaction) {
    return respond(interaction, homeFor(interaction.guild));
  },
};
