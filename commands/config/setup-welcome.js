const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { getWelcomeConfig } = require('../../utils/welcomeConfig');
const { buildPanelPayload } = require('../../handlers/welcomeSetupHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('setup-welcome')
    .setDescription('Abre o painel de configuração das mensagens de boas-vindas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const config = getWelcomeConfig(interaction.guild.id);
    return respond(interaction, buildPanelPayload(config, interaction.member));
  },
};
