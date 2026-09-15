// @ts-check
/**
 * Quem pode o quê num ticket.
 *
 * Os overwrites do canal já escondem o ticket de quem não é da equipe, então
 * isto é a segunda camada: o autor **enxerga** os botões de reivindicar e
 * encerrar, e sem esta checagem ele mesmo poderia se atender e apagar o canal
 * com o transcript.
 *
 * Compatibilidade importa aqui: servidores que nunca preencheram
 * `permissions.staffRoleIds` configuraram apenas o cargo de suporte de cada
 * categoria. Ignorá-los deixaria o atendimento inteiro travado no primeiro
 * deploy, então o cargo de suporte de qualquer categoria também conta como
 * equipe.
 */

const { db } = require('../../database/db');

const supportRolesStmt = db.prepare(
  'SELECT support_role_id FROM ticket_categories WHERE guild_id = ? AND support_role_id IS NOT NULL'
);

const isAdmin = (member) => Boolean(member?.permissions?.has?.('Administrator'));

const hasAnyRole = (member, roleIds) => roleIds.some((id) => member?.roles?.cache?.has?.(id));

/**
 * Cargos que atendem tickets: os configurados no painel mais os cargos de
 * suporte das categorias.
 * @param {string} guildId
 * @param {import('./config').TicketConfig} config
 * @returns {string[]}
 */
function ticketStaffRoleIds(guildId, config) {
  const fromCategories = supportRolesStmt.all(guildId).map((row) => row.support_role_id);
  return [
    ...new Set([...config.permissions.staffRoleIds, ...config.permissions.managerRoleIds, ...fromCategories]),
  ];
}

/**
 * Pode atender: reivindicar e conversar como equipe.
 * @param {import('discord.js').GuildMember|null} member
 * @param {import('./config').TicketConfig} config
 */
function isTicketStaff(member, config) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  return hasAnyRole(member, ticketStaffRoleIds(member.guild.id, config));
}

/**
 * Pode encerrar de vez (apagando o canal) e reabrir.
 *
 * Sem cargos de gerência configurados, o atendimento serve: exigir uma gerência
 * que ninguém definiu deixaria só os administradores capazes de fechar ticket.
 * @param {import('discord.js').GuildMember|null} member
 * @param {import('./config').TicketConfig} config
 */
function isTicketManager(member, config) {
  if (!member) return false;
  if (isAdmin(member)) return true;
  const { managerRoleIds } = config.permissions;
  if (!managerRoleIds.length) return isTicketStaff(member, config);
  return hasAnyRole(member, managerRoleIds);
}

module.exports = { ticketStaffRoleIds, isTicketStaff, isTicketManager };
