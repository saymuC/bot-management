// @ts-check
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { buildEconomyPanel } = require('../../handlers/economyHandler');

module.exports = {
  ephemeral: true,
  permissionGroup: 'economy',
  requiredPermission: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder().setName('economy-config').setDescription('Configura a economia do servidor')
    .setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    return respond(interaction, buildEconomyPanel(interaction.guild));
  },
};
