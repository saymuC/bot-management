// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { getEconomyConfig } = require('../../config/economy');
const { getActiveGame, expireGame, attachActiveMessage } = require('../../utils/economy/mines/service');
const { settingsPanel, renderGame, rememberPanelEditor } = require('../../handlers/minesHandler');
const { errorEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder().setName('mines').setDescription('Jogue Mines com as moedas da economia').setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Mines só está disponível em servidores.');
    const config = getEconomyConfig(interaction.guild.id);
    if (!config.enabled || !config.mines.enabled) {
      return respond(interaction, { embeds: [errorEmbed('Mines está desativado neste servidor.', undefined, interaction.guild)] });
    }
    let game = getActiveGame(interaction.guild.id, interaction.user.id);
    if (game && game.expires_at <= Date.now()) game = expireGame({ guildId: interaction.guild.id, userId: interaction.user.id, gameId: game.id });
    if (game) {
      const message = await respond(interaction, renderGame(interaction.guild, game));
      if (message?.id) attachActiveMessage(interaction.guild.id, interaction.user.id, interaction.channelId, message.id);
      if (message?.id) rememberPanelEditor(game.id, interaction.webhook, message.id, interaction.guild, interaction.user.id);
      return message;
    }
    return respond(interaction, settingsPanel(interaction.guild, interaction.user.id));
  },
};
