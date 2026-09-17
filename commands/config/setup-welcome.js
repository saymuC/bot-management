const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { getWelcomeConfig } = require('../../utils/welcomeConfig');
const { buildPanelPayload } = require('../../handlers/welcomeSetupHandler');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'config',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('setup-welcome')
    .setDescription('Abre o painel de configuração das mensagens de boas-vindas')
    .setDMPermission(false),

  async execute(interaction) {
    const config = getWelcomeConfig(interaction.guild.id);
    return respond(interaction, buildPanelPayload(config, interaction.member));
  },
};
