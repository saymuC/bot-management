const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { homeFor } = require('../../handlers/ticketSetupHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('ticket-config')
    .setDescription('Abre o painel de configuração do sistema de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    return respond(interaction, homeFor(interaction.guild));
  },
};
