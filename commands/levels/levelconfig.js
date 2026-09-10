const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { getLevelsConfig } = require('../../utils/levels/config');
const { buildPanelPayload } = require('../../handlers/levelsSetupHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('levelconfig')
    .setDescription('Abre o painel de configuração do sistema de níveis e XP')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const config = getLevelsConfig(interaction.guild.id);
    return respond(interaction, buildPanelPayload(config, interaction.guild));
  },
};
