const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { buildStatsPage } = require('../../handlers/ticketStatsHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('ticket-stats')
    .setDescription('Ranking dos atendentes: nota média, tickets reivindicados/fechados e TMA')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt.setName('pagina').setDescription('Página inicial (10 atendentes por página)').setMinValue(1)
    ),

  async execute(interaction) {
    const page = (interaction.options.getInteger('pagina') ?? 1) - 1;
    return respond(interaction, buildStatsPage(interaction.guild.id, page));
  },
};
