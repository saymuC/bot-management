const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { centerPayload } = require('../../handlers/configCenterHandler');
const { errorEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure os principais sistemas do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return respond(interaction, {
        embeds: [errorEmbed('Você precisa ser administrador para usar este comando.', undefined, interaction.guild)],
      });
    }

    return respond(interaction, centerPayload(interaction.guild));
  },
};
