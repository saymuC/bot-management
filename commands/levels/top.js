const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { buildTopPayload } = require('../../handlers/levelsLeaderboardHandler');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Mostra o ranking de XP do servidor')
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt.setName('pagina').setDescription('Página do ranking (padrão: 1)').setMinValue(1).setMaxValue(10_000)
    ),

  async execute(interaction) {
    const payload = await buildTopPayload(interaction.guild, interaction.options.getInteger('pagina') ?? 1);
    return respond(interaction, payload);
  },
};
