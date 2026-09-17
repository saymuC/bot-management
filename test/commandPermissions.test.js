/**
 * Regras de decisão do gate de permissões (utils/commandPermissions.js).
 *
 * Cada teste aqui é uma das sete regras de prioridade — é o arquivo que falha
 * quando alguém troca a ordem delas.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');

const {
  canUseCommand,
  clearCommandOverride,
  getCommandPermissions,
  normalizeCommandPermissions,
  saveCommandPermissions,
  setCommandOverride,
  setGroupRoles,
} = require('../utils/commandPermissions');

const OWNER = '800000000000000001';
const MEMBER = '800000000000000002';
const STAFF_ROLE = '800000000000000010';
const MANAGER_ROLE = '800000000000000011';

/** Cada teste usa uma guild própria: a configuração vive no banco. */
let seq = 0;
const nextGuild = () => `81000000000000${String(++seq).padStart(4, '0')}`;

function interaction(guildId, { userId = MEMBER, admin = false, roleIds = [], legacy = [] } = {}) {
  return {
    guildId,
    guild: { id: guildId, ownerId: OWNER },
    user: { id: userId },
    member: { id: userId, roles: { cache: new Set(roleIds) } },
    memberPermissions: {
      has: (permission) => (admin && permission === PermissionFlagsBits.Administrator) || legacy.includes(permission),
    },
  };
}

test('dono do servidor passa sempre, mesmo em admin_only', () => {
  const guild = nextGuild();
  setCommandOverride(guild, 'ban', { mode: 'admin_only' });

  assert.equal(canUseCommand(interaction(guild, { userId: OWNER }), 'ban'), true);
});

test('membro com Administrator passa sempre', () => {
  const guild = nextGuild();
  setCommandOverride(guild, 'ban', { mode: 'admin_only' });

  assert.equal(canUseCommand(interaction(guild, { admin: true }), 'ban'), true);
});

test('cargo do grupo libera os comandos daquele grupo', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'moderation', [STAFF_ROLE]);
  const staff = interaction(guild, { roleIds: [STAFF_ROLE] });

  assert.equal(canUseCommand(staff, 'warn'), true);
  assert.equal(canUseCommand(staff, 'clear'), true);
  // Outro grupo não vem de brinde.
  assert.equal(canUseCommand(staff, 'ticket-stats'), false);
});

test('custom substitui o grupo nos dois sentidos', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'moderation', [STAFF_ROLE]);
  setCommandOverride(guild, 'infractions', { mode: 'custom', roleIds: [MANAGER_ROLE] });

  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'infractions'), false);
  assert.equal(canUseCommand(interaction(guild, { roleIds: [MANAGER_ROLE] }), 'infractions'), true);
  // O cargo do comando não vaza para o resto do grupo.
  assert.equal(canUseCommand(interaction(guild, { roleIds: [MANAGER_ROLE] }), 'warn'), false);
});

test('admin_only bloqueia cargo comum e a permissão nativa', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'moderation', [STAFF_ROLE]);
  setCommandOverride(guild, 'ban', { mode: 'admin_only' });

  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'ban'), false);
  assert.equal(canUseCommand(interaction(guild, { legacy: [PermissionFlagsBits.BanMembers] }), 'ban'), false);
});

test('inherit volta a seguir o grupo', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'moderation', [STAFF_ROLE]);
  setCommandOverride(guild, 'warn', { mode: 'custom', roleIds: [MANAGER_ROLE] });
  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'warn'), false);

  setCommandOverride(guild, 'warn', { mode: 'inherit' });
  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'warn'), true);
  assert.equal(getCommandPermissions(guild).commands.warn, undefined);
});

test('limpar o override também volta para o grupo', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'tickets', [STAFF_ROLE]);
  setCommandOverride(guild, 'ticket-stats', { mode: 'admin_only' });
  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'ticket-stats'), false);

  clearCommandOverride(guild, 'ticket-stats');
  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'ticket-stats'), true);
});

test('sem nada configurado vale a permissão nativa antiga', () => {
  const guild = nextGuild();

  assert.equal(canUseCommand(interaction(guild, { legacy: [PermissionFlagsBits.ModerateMembers] }), 'warn'), true);
  assert.equal(canUseCommand(interaction(guild, { legacy: [PermissionFlagsBits.ManageMessages] }), 'warn'), false);
  assert.equal(canUseCommand(interaction(guild), 'warn'), false);
});

test('grupo sem cargos não tira a permissão nativa dos comandos', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'moderation', [STAFF_ROLE]);
  setGroupRoles(guild, 'moderation', []);

  assert.equal(canUseCommand(interaction(guild, { legacy: [PermissionFlagsBits.ModerateMembers] }), 'warn'), true);
});

test('os quatro comandos críticos nascem em admin_only', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'config', [STAFF_ROLE]);
  setGroupRoles(guild, 'messages', [STAFF_ROLE]);
  const staff = interaction(guild, { roleIds: [STAFF_ROLE] });

  for (const name of ['config', 'bot-status', 'pull-user', 'nuke']) {
    assert.equal(canUseCommand(staff, name), false, name);
  }
  // O resto do grupo continua liberado pelo cargo.
  assert.equal(canUseCommand(staff, 'setup-logs'), true);
  assert.equal(canUseCommand(staff, 'say'), true);
});

test('padrão admin_only é destravável pelo painel', () => {
  const guild = nextGuild();
  setCommandOverride(guild, 'config', { mode: 'custom', roleIds: [MANAGER_ROLE] });

  assert.equal(canUseCommand(interaction(guild, { roleIds: [MANAGER_ROLE] }), 'config'), true);
});

test('comando fora do catálogo não é controlado aqui', () => {
  const guild = nextGuild();
  assert.equal(canUseCommand(interaction(guild), 'ping'), true);
  assert.equal(canUseCommand(interaction(guild), 'rank'), true);
});

test('fora de servidor recusa', () => {
  assert.equal(canUseCommand({ user: { id: MEMBER } }, 'ban'), false);
});

test('aceita o módulo do comando, não só o nome', () => {
  const guild = nextGuild();
  setCommandOverride(guild, 'ban', { mode: 'admin_only' });

  assert.equal(canUseCommand(interaction(guild, { legacy: [PermissionFlagsBits.BanMembers] }), { data: { name: 'ban' } }), false);
});

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

test('configuração inválida volta ao padrão em vez de estourar', () => {
  for (const raw of ['{{{', null, 42, '[]', { groups: 'nada', commands: 7 }]) {
    const config = normalizeCommandPermissions(raw);
    assert.deepEqual(config.commands, {});
    assert.deepEqual(config.groups.moderation, []);
  }
});

test('normalização descarta id inválido, repetido, grupo e comando inexistentes', () => {
  const config = normalizeCommandPermissions({
    groups: { moderation: [STAFF_ROLE, STAFF_ROLE, 'abc', 12, null], inexistente: [STAFF_ROLE] },
    commands: {
      warn: { mode: 'custom', roleIds: [MANAGER_ROLE] },
      'comando-que-nao-existe': { mode: 'admin_only' },
      ban: { mode: 'modo-inventado' },
    },
  });

  assert.deepEqual(config.groups.moderation, [STAFF_ROLE]);
  assert.equal(config.groups.inexistente, undefined);
  assert.deepEqual(config.commands.warn, { mode: 'custom', roleIds: [MANAGER_ROLE] });
  assert.equal(config.commands['comando-que-nao-existe'], undefined);
  // Modo desconhecido cai em inherit, que não é guardado.
  assert.equal(config.commands.ban, undefined);
});

test('custom sem cargo nenhum não tranca o comando: volta a herdar', () => {
  const guild = nextGuild();
  setGroupRoles(guild, 'moderation', [STAFF_ROLE]);
  setCommandOverride(guild, 'warn', { mode: 'custom', roleIds: [] });

  assert.equal(getCommandPermissions(guild).commands.warn, undefined);
  assert.equal(canUseCommand(interaction(guild, { roleIds: [STAFF_ROLE] }), 'warn'), true);
});

test('admin_only não guarda cargos, que ali não teriam efeito', () => {
  const guild = nextGuild();
  const saved = setCommandOverride(guild, 'ban', { mode: 'admin_only', roleIds: [STAFF_ROLE] });

  assert.deepEqual(saved.commands.ban, { mode: 'admin_only', roleIds: [] });
});

test('teto de 10 cargos por grupo', () => {
  const many = Array.from({ length: 15 }, (_, i) => `82000000000000${String(i).padStart(4, '0')}`);
  const config = normalizeCommandPermissions({ groups: { moderation: many } });

  assert.equal(config.groups.moderation.length, 10);
});

test('salvar e reler devolve a mesma configuração', () => {
  const guild = nextGuild();
  const saved = saveCommandPermissions(guild, {
    groups: { moderation: [STAFF_ROLE] },
    commands: { ban: { mode: 'admin_only', roleIds: [] } },
  });

  assert.deepEqual(getCommandPermissions(guild), saved);
});
