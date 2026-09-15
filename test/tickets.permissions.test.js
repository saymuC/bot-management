/**
 * Quem pode atender e quem pode encerrar.
 *
 * Os botões "Reivindicar" e "Fechar" ficam visíveis para o autor do ticket, então
 * este gate é o que impede alguém de se autoatender (falseando as estatísticas) e
 * de apagar o canal com o transcript antes de a equipe ler o caso. Os dois casos
 * de compatibilidade também estão travados aqui: servidor que só configurou o
 * cargo de suporte da categoria continua atendendo, e servidor sem gerência
 * definida continua conseguindo fechar ticket.
 *
 * Toca o banco de verdade sob um `guild_id` reservado (não é snowflake), com
 * limpeza antes e depois.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { db } = require('../database/db');
const { normalizeTicketConfig } = require('../utils/tickets/config');
const { isTicketStaff, isTicketManager } = require('../utils/tickets/permissions');

const GUILD = 'test-tickets-permissions';
const STAFF_ROLE = '100000000000000001';
const MANAGER_ROLE = '100000000000000002';
const CATEGORY_ROLE = '100000000000000003';

const cleanup = () => db.prepare('DELETE FROM ticket_categories WHERE guild_id = ?').run(GUILD);

/** Membro de mentira: só permissões e cargos são consultados. */
const member = ({ admin = false, roles = [] } = {}) => ({
  guild: { id: GUILD },
  permissions: { has: () => admin },
  roles: { cache: new Set(roles) },
});

test.before(cleanup);
test.after(cleanup);

test('sem cargo nenhum, ninguém atende nem encerra', () => {
  const config = normalizeTicketConfig({});
  assert.equal(isTicketStaff(member(), config), false);
  assert.equal(isTicketManager(member(), config), false);
  // Interação fora de servidor não tem member.
  assert.equal(isTicketStaff(null, config), false);
});

test('administrador passa em tudo', () => {
  const config = normalizeTicketConfig({});
  assert.equal(isTicketStaff(member({ admin: true }), config), true);
  assert.equal(isTicketManager(member({ admin: true }), config), true);
});

test('cargo de atendimento atende, mas não encerra quando há gerência', () => {
  const config = normalizeTicketConfig({
    permissions: { staffRoleIds: [STAFF_ROLE], managerRoleIds: [MANAGER_ROLE] },
  });
  const staff = member({ roles: [STAFF_ROLE] });

  assert.equal(isTicketStaff(staff, config), true);
  assert.equal(isTicketManager(staff, config), false);

  const manager = member({ roles: [MANAGER_ROLE] });
  assert.equal(isTicketStaff(manager, config), true, 'gerência também atende');
  assert.equal(isTicketManager(manager, config), true);
});

test('sem gerência configurada, o atendimento encerra', () => {
  const config = normalizeTicketConfig({ permissions: { staffRoleIds: [STAFF_ROLE] } });
  assert.equal(isTicketManager(member({ roles: [STAFF_ROLE] }), config), true);
});

test('cargo de suporte da categoria conta como atendimento', () => {
  db.prepare(
    'INSERT INTO ticket_categories (guild_id, label, support_role_id) VALUES (?, ?, ?)'
  ).run(GUILD, 'Suporte', CATEGORY_ROLE);

  // Config vazia: este servidor nunca preencheu staffRoleIds no painel.
  const config = normalizeTicketConfig({});
  assert.equal(isTicketStaff(member({ roles: [CATEGORY_ROLE] }), config), true);
  assert.equal(isTicketManager(member({ roles: [CATEGORY_ROLE] }), config), true);
});
