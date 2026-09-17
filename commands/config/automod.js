const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { getAutomodConfig } = require('../../utils/automod/config');
const { homeFor } = require('../../handlers/automodSetupHandler');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'config',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Abre o painel de configuração do AutoMod')
    .setDMPermission(false),

  async execute(interaction) {
    const config = getAutomodConfig(interaction.guild.id);
    return respond(interaction, homeFor(interaction, config));
  },
};
