const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { getAutomodConfig } = require('../../utils/automod/config');
const { homePayload } = require('../../handlers/automodSetupHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Abre o painel de configuração do AutoMod')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const config = getAutomodConfig(interaction.guild.id);
    return respond(interaction, homePayload(config, interaction.guild));
  },
};
