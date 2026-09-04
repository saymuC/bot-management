const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { setGuildConfig } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
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
      return interaction.reply({ embeds: [successEmbed('Autorole desativado.')], flags: MessageFlags.Ephemeral });
    }

    if (role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      return interaction.reply({
        embeds: [errorEmbed('Não consigo atribuir este cargo (hierarquia ou cargo gerenciado).')],
        flags: MessageFlags.Ephemeral,
      });
    }

    setGuildConfig(interaction.guild.id, 'autorole_id', role.id);
    return interaction.reply({
      embeds: [successEmbed(`Novos membros receberão automaticamente o cargo ${role}.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
