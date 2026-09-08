const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { errorEmbed } = require('../../utils/embeds');
const { buildEmojiPanel, isAllowed } = require('../../handlers/emojiConfigHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('config-emojis')
    .setDescription('Abre o painel para trocar os emojis usados pelo bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!isAllowed(interaction)) {
      return respond(interaction, { embeds: [errorEmbed('Você precisa ser administrador para alterar os emojis do bot.')] });
    }
    return respond(interaction, buildEmojiPanel(interaction.guild));
  },
};
