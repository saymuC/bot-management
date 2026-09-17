const { PermissionFlagsBits } = require('discord.js');

const DANGEROUS_PERMISSIONS = Object.freeze([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
]);

function dangerousPermissionNames(role) {
  if (!role?.permissions?.has) return [];
  return DANGEROUS_PERMISSIONS.filter((permission) => role.permissions.has(permission)).map(String);
}

function validateAssignableRole(interaction, role, { allowDangerousPermissions = false } = {}) {
  if (!role) return 'Cargo não encontrado.';
  if (role.id === interaction.guild.roles.everyone?.id || role.id === interaction.guild.id) {
    return 'Este cargo não pode ser atribuído manualmente.';
  }
  if (role.managed) return 'Este cargo é gerenciado por uma integração.';
  if (role.position >= interaction.guild.members.me.roles.highest.position) {
    return 'Meu cargo precisa estar acima do cargo escolhido para eu poder atribuí-lo.';
  }

  const member = interaction.member;
  const memberId = member.id ?? member.user?.id;
  if (interaction.guild.ownerId !== memberId && role.position >= member.roles.highest.position) {
    return 'Você só pode configurar cargos abaixo do seu cargo mais alto.';
  }

  if (!allowDangerousPermissions && dangerousPermissionNames(role).length) {
    return 'Este cargo tem permissões administrativas e não pode ser usado por sistemas automáticos.';
  }

  return null;
}

function roleBlockReason(guild, roleId, { allowDangerousPermissions = false } = {}) {
  const role = guild.roles.cache.get(roleId);
  if (!role) return `<@&${roleId}> não existe mais`;
  if (role.id === guild.id || role.id === guild.roles.everyone?.id) return '@everyone não pode ser recompensa';
  if (role.managed) return `${role.name} é gerenciado por uma integração`;

  const me = guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return `${role.name} está acima do bot na hierarquia`;
  }
  if (!allowDangerousPermissions && dangerousPermissionNames(role).length) {
    return `${role.name} tem permissões administrativas`;
  }
  return null;
}

module.exports = { DANGEROUS_PERMISSIONS, validateAssignableRole, roleBlockReason };
