const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { centerPayload } = require('../../handlers/configCenterHandler');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'config',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure os principais sistemas do servidor')
    .setDMPermission(false),

  async execute(interaction) {
    // Sem checagem própria aqui de propósito: o gate de events/interactionCreate.js
    // já decidiu, e repetir "precisa ser Administrator" trancaria justamente o
    // cargo que o painel de permissões acabou de autorizar.
    return respond(interaction, centerPayload(interaction.guild));
  },
};
