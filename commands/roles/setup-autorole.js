const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { setGuildConfig } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('setup-autorole')
    .setDescription('Define o cargo automático para novos membros')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addRoleOption((opt) => opt.setName('cargo').setDescription('Cargo automático (vazio para desativar)')),

  async execute(interaction) {
    const role = interaction.options.getRole('cargo');

    if (!role) {
      setGuildConfig(interaction.guild.id, 'autorole_id', null);
      return respond(interaction, { embeds: [successEmbed('Autorole desativado.')] });
    }

    if (role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      return respond(interaction, {
        embeds: [errorEmbed('Não consigo atribuir este cargo (hierarquia ou cargo gerenciado).')],
      });
    }

    setGuildConfig(interaction.guild.id, 'autorole_id', role.id);
    return respond(interaction, {
      embeds: [successEmbed(`Novos membros receberão automaticamente o cargo ${role}.`)],
    });
  },
};
