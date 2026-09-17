const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { errorEmbed } = require('../../utils/embeds');
const { buildEmojiPanel, isAllowed } = require('../../handlers/emojiConfigHandler');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'config',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('config-emojis')
    .setDescription('Abre o painel para trocar os emojis usados pelo bot')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isAllowed(interaction)) {
      return respond(interaction, { embeds: [errorEmbed('Você precisa ser administrador para alterar os emojis do bot.')] });
    }
    return respond(interaction, buildEmojiPanel(interaction.guild));
  },
};
