const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { setGuildConfig } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');
const { validateAssignableRole } = require('../../utils/assignableRoles');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'roles',
  requiredPermission: PermissionFlagsBits.ManageRoles,
  data: new SlashCommandBuilder()
    .setName('setup-autorole')
    .setDescription('Define o cargo automático para novos membros')
    .setDMPermission(false)
    .addRoleOption((opt) => opt.setName('cargo').setDescription('Cargo automático (vazio para desativar)')),

  async execute(interaction) {
    const role = interaction.options.getRole('cargo');

    if (!role) {
      setGuildConfig(interaction.guild.id, 'autorole_id', null);
      return respond(interaction, { embeds: [successEmbed('Autorole desativado.')] });
    }

    const problem = validateAssignableRole(interaction, role);
    if (problem) return respond(interaction, { embeds: [errorEmbed(problem)] });

    setGuildConfig(interaction.guild.id, 'autorole_id', role.id);
    return respond(interaction, {
      embeds: [successEmbed(`Novos membros receberão automaticamente o cargo ${role}.`)],
    });
  },
};
