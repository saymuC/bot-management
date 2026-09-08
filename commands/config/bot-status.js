const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { errorEmbed } = require('../../utils/embeds');
const { buildStatusPanel, clearDraft, isAllowed } = require('../../handlers/botStatusHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Abre o painel para alterar o status e a atividade do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isAllowed(interaction)) {
      return respond(interaction, { embeds: [errorEmbed('Você não tem permissão para alterar o status do bot.')] });
    }

    // Cada abertura começa do que está no ar, sem herdar rascunho antigo.
    clearDraft(interaction.user.id);
    return respond(interaction, buildStatusPanel(interaction.user.id));
  },
};
