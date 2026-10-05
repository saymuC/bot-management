// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { buildRanking } = require('../../handlers/economyLeaderboardHandler');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('ranking').setDescription('Mostra os mais ricos do servidor')
    .setDMPermission(false)
    .addIntegerOption((opt) => opt.setName('pagina').setDescription('Página do ranking').setMinValue(1).setMaxValue(10000)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    return respond(interaction, await buildRanking(interaction.guild, interaction.options.getInteger('pagina') ?? 1, interaction.user.id));
  },
};
