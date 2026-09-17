/**
 * Painel de permissões de comandos (`/config` -> Permissões de comandos).
 *
 * O que interessa aqui é o painel salvar no clique e nunca oferecer um caminho
 * que tranque o servidor: @everyone recusado, e o seletor de cargos só na tela
 * em que ele faz alguma coisa.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');

const { getCommandPermissions, setCommandOverride, setGroupRoles } = require('../utils/commandPermissions');
const { routePermissionsSetup } = require('../handlers/permissionsSetupHandler');
const { centerPayload } = require('../handlers/configCenterHandler');

const STAFF_ROLE = '830000000000000010';
const MANAGER_ROLE = '830000000000000011';

let seq = 0;
const nextGuildId = () => `84000000000000${String(++seq).padStart(4, '0')}`;

function fakeGuild(id) {
  const role = (roleId, name) => ({ id: roleId, name, toString: () => `<@&${roleId}>` });
  return {
    id,
    name: 'Servidor de Teste',
    ownerId: '830000000000000099',
    roles: {
      everyone: { id },
      cache: new Collection([
        [STAFF_ROLE, role(STAFF_ROLE, 'Staff')],
        [MANAGER_ROLE, role(MANAGER_ROLE, 'Gerente')],
      ]),
    },
    emojis: { cache: new Collection() },
  };
}

function interaction({ customId, values = [], roles = [], admin = true, guildId = nextGuildId() } = {}) {
  const guild = fakeGuild(guildId);
  const calls = [];
  return {
    customId,
    values,
    guild,
    guildId: guild.id,
    createdTimestamp: Date.now(),
    member: { id: '830000000000000002', roles: { cache: new Set() } },
    user: { id: '830000000000000002' },
    memberPermissions: { has: (permission) => admin && permission === PermissionFlagsBits.Administrator },
    inGuild: () => true,
    roles: { values: () => roles.map((id) => guild.roles.cache.get(id) ?? { id }) },
    calls,
    update: async (payload) => calls.push({ method: 'update', payload }),
    reply: async (payload) => calls.push({ method: 'reply', payload }),
  };
}

const rows = (payload) => payload.components.map((row) => row.toJSON());
const firstComponent = (payload, index = 0) => rows(payload)[index].components[0];
const lastCall = (i) => i.calls.at(-1).payload;

test('a central de configuração oferece o painel de permissões', () => {
  const select = centerPayload(fakeGuild(nextGuildId())).components[0].toJSON().components[0];
  assert.ok(
    select.options.some((option) => option.value === 'permissions'),
    'opção "permissions" ausente no /config'
  );
});

test('tela inicial lista os sete grupos e os dois caminhos', async () => {
  const i = interaction({ customId: 'perms_home' });
  await routePermissionsSetup(i);

  const payload = lastCall(i);
  const buttons = rows(payload)[0].components.map((button) => button.custom_id);
  assert.deepEqual(buttons, ['perms_groups', 'perms_commands']);
  for (const label of ['Configuração', 'Moderação', 'Tickets', 'Níveis', 'Sorteios', 'Mensagens', 'Cargos']) {
    assert.match(payload.embeds[0].data.description, new RegExp(label), label);
  }
});

test('selecionar cargos do grupo salva na hora', async () => {
  const guildId = nextGuildId();
  const i = interaction({ customId: 'perms_group-roles:moderation', roles: [STAFF_ROLE, MANAGER_ROLE], guildId });

  await routePermissionsSetup(i);

  assert.deepEqual(getCommandPermissions(guildId).groups.moderation, [STAFF_ROLE, MANAGER_ROLE]);
  assert.match(lastCall(i).embeds[0].data.description, /Cargos autorizados: <@&/);
});

test('@everyone é recusado com aviso em vez de liberar o servidor', async () => {
  const guildId = nextGuildId();
  const i = interaction({ customId: 'perms_group-roles:moderation', roles: [guildId, STAFF_ROLE], guildId });

  await routePermissionsSetup(i);

  assert.deepEqual(getCommandPermissions(guildId).groups.moderation, [STAFF_ROLE]);
  assert.match(lastCall(i).embeds[0].data.description, /@everyone foi ignorado/);
});

test('limpar cargos do grupo esvazia a lista', async () => {
  const guildId = nextGuildId();
  setGroupRoles(guildId, 'tickets', [STAFF_ROLE]);
  const i = interaction({ customId: 'perms_group-clear:tickets', guildId });

  await routePermissionsSetup(i);

  assert.deepEqual(getCommandPermissions(guildId).groups.tickets, []);
  assert.match(lastCall(i).embeds[0].data.description, /voltaram à permissão antiga/);
});

test('fluxo por comando: grupo, comando e modo', async () => {
  const guildId = nextGuildId();

  const group = interaction({ customId: 'perms_cmd-group', values: ['moderation'], guildId });
  await routePermissionsSetup(group);
  assert.equal(firstComponent(lastCall(group)).custom_id, 'perms_cmd-pick:moderation');

  const pick = interaction({ customId: 'perms_cmd-pick:moderation', values: ['ban'], guildId });
  await routePermissionsSetup(pick);
  assert.equal(firstComponent(lastCall(pick)).custom_id, 'perms_cmd-mode:ban');
  assert.match(lastCall(pick).embeds[0].data.title, /\/ban$/);

  const mode = interaction({ customId: 'perms_cmd-mode:ban', values: ['admin_only'], guildId });
  await routePermissionsSetup(mode);
  assert.deepEqual(getCommandPermissions(guildId).commands.ban, { mode: 'admin_only', roleIds: [] });
});

test('seletor de cargos aparece só no modo Cargos específicos', async () => {
  const guildId = nextGuildId();

  const toCustom = interaction({ customId: 'perms_cmd-mode:warn', values: ['custom'], guildId });
  await routePermissionsSetup(toCustom);
  assert.equal(firstComponent(lastCall(toCustom), 1).custom_id, 'perms_cmd-roles:warn');
  assert.match(lastCall(toCustom).embeds[0].data.description, /Escolha os cargos abaixo/);

  const toInherit = interaction({ customId: 'perms_cmd-mode:warn', values: ['inherit'], guildId });
  await routePermissionsSetup(toInherit);
  const customIds = rows(lastCall(toInherit)).flatMap((row) => row.components.map((c) => c.custom_id));
  assert.equal(customIds.includes('perms_cmd-roles:warn'), false);
});

test('cargos do comando salvam e o botão de limpar volta ao grupo', async () => {
  const guildId = nextGuildId();
  setGroupRoles(guildId, 'moderation', [STAFF_ROLE]);

  const save = interaction({ customId: 'perms_cmd-roles:infractions', roles: [MANAGER_ROLE], guildId });
  await routePermissionsSetup(save);
  assert.deepEqual(getCommandPermissions(guildId).commands.infractions, { mode: 'custom', roleIds: [MANAGER_ROLE] });

  const clear = interaction({ customId: 'perms_cmd-clear:infractions', guildId });
  await routePermissionsSetup(clear);
  assert.equal(getCommandPermissions(guildId).commands.infractions, undefined);
  assert.match(lastCall(clear).embeds[0].data.description, /voltou a herdar do grupo/);
});

test('limpar ajuste de comando crítico diz que ele volta ao padrão travado', async () => {
  const guildId = nextGuildId();
  setCommandOverride(guildId, 'nuke', { mode: 'custom', roleIds: [STAFF_ROLE] });
  const i = interaction({ customId: 'perms_cmd-clear:nuke', guildId });

  await routePermissionsSetup(i);

  assert.match(lastCall(i).embeds[0].data.description, /Somente Administrator/);
});

test('grupo e comando desconhecidos não estouram', async () => {
  for (const customId of ['perms_group-roles:inventado', 'perms_cmd-clear:inventado', 'perms_nada']) {
    const i = interaction({ customId, roles: [STAFF_ROLE] });
    await routePermissionsSetup(i);
    assert.deepEqual(i.calls, [], customId);
  }
});

test('sem permissão o painel recusa sem salvar', async () => {
  const guildId = nextGuildId();
  const i = interaction({ customId: 'perms_group-roles:moderation', roles: [STAFF_ROLE], admin: false, guildId });

  await routePermissionsSetup(i);

  assert.equal(i.calls[0].method, 'reply');
  assert.match(i.calls[0].payload.embeds[0].data.description, /não tem permissão/);
  assert.deepEqual(getCommandPermissions(guildId).groups.moderation, []);
});
