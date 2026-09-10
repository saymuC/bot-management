/**
 * Testes das recompensas por nível.
 *
 * A parte que decide o que conceder e o que retirar é pura de propósito
 * (`desiredRoleIds` e `reconcile`), então dá para testar a regra sem simular a
 * API do Discord. O que sobra de `syncMemberRewards` é chamada de rede, e os
 * testes dela usam um membro de mentira só para verificar que uma falha volta em
 * `problems` em vez de lançar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');

const { normalizeConfig } = require('../utils/levels/config');
const { managedRoleIds, desiredRoleIds, reconcile, roleBlockReason, syncMemberRewards } =
  require('../utils/levels/rewards');

const R5 = '500000000000000005';
const R8 = '500000000000000008';
const R10 = '500000000000000010';
const EXTERNO = '500000000000000099';

const configWith = (rewardMode) =>
  normalizeConfig({
    rewardMode,
    rewards: [
      { level: 5, roleIds: [R5] },
      { level: 8, roleIds: [R8] },
      { level: 10, roleIds: [R10] },
    ],
  });

// ---------------------------------------------------------------------------
// Estado desejado
// ---------------------------------------------------------------------------

test('stack acumula os cargos de todos os níveis alcançados', () => {
  const config = configWith('stack');

  assert.deepEqual([...desiredRoleIds(config, 4)], []);
  assert.deepEqual([...desiredRoleIds(config, 5)], [R5]);
  assert.deepEqual([...desiredRoleIds(config, 9)], [R5, R8]);
  assert.deepEqual([...desiredRoleIds(config, 10)], [R5, R8, R10]);
  assert.deepEqual([...desiredRoleIds(config, 50)], [R5, R8, R10]);
});

test('highest mantém só os cargos do maior nível alcançado', () => {
  const config = configWith('highest');

  assert.deepEqual([...desiredRoleIds(config, 4)], []);
  assert.deepEqual([...desiredRoleIds(config, 5)], [R5]);
  assert.deepEqual([...desiredRoleIds(config, 9)], [R8]);
  assert.deepEqual([...desiredRoleIds(config, 10)], [R10]);
});

test('um salto de 4 para 10 considera as recompensas de 5, 8 e 10', () => {
  // O caso que a concessão simples erra: conceder "o cargo do nível novo" daria
  // só o do 10 e deixaria o membro sem os dois do meio, para sempre.
  const config = configWith('stack');
  const { toAdd, toRemove } = reconcile(desiredRoleIds(config, 10), managedRoleIds(config), []);

  assert.deepEqual(toAdd.sort(), [R5, R8, R10].sort());
  assert.deepEqual(toRemove, []);
});

test('cair de nível retira o que já não vale', () => {
  const config = configWith('stack');
  const { toAdd, toRemove } = reconcile(desiredRoleIds(config, 5), managedRoleIds(config), [R5, R8, R10]);

  assert.deepEqual(toAdd, []);
  assert.deepEqual(toRemove.sort(), [R8, R10].sort());
});

test('highest troca o cargo antigo pelo novo em vez de somar', () => {
  const config = configWith('highest');
  const { toAdd, toRemove } = reconcile(desiredRoleIds(config, 8), managedRoleIds(config), [R5]);

  assert.deepEqual(toAdd, [R8]);
  assert.deepEqual(toRemove, [R5]);
});

test('cargo que não é recompensa nunca é removido', () => {
  // A trava central: o escopo do módulo é o que ele mesmo distribui. Um cargo de
  // staff, de booster ou de self-role não pode desaparecer porque alguém subiu.
  const config = configWith('highest');
  const { toRemove } = reconcile(desiredRoleIds(config, 10), managedRoleIds(config), [EXTERNO, R5]);

  assert.ok(!toRemove.includes(EXTERNO));
  assert.deepEqual(toRemove, [R5]);
});

test('nada a fazer quando o membro já tem exatamente o esperado', () => {
  const config = configWith('stack');
  const { toAdd, toRemove } = reconcile(desiredRoleIds(config, 10), managedRoleIds(config), [R5, R8, R10, EXTERNO]);

  assert.deepEqual(toAdd, []);
  assert.deepEqual(toRemove, []);
});

// ---------------------------------------------------------------------------
// Cargos que o bot não pode usar
// ---------------------------------------------------------------------------

/** Guild de mentira: só os campos que `roleBlockReason` lê. */
function fakeGuild({ roles = [], botPosition = 100, permissions = [PermissionFlagsBits.ManageRoles] } = {}) {
  const guild = {
    id: 'guild-id',
    roles: { cache: new Collection(roles.map((role) => [role.id, role])) },
  };
  guild.members = {
    me: {
      roles: { highest: { position: botPosition } },
      permissions: { has: (perm) => permissions.includes(perm) },
    },
  };
  return guild;
}

test('roleBlockReason aponta o motivo de cada cargo inutilizável', () => {
  const guild = fakeGuild({
    roles: [
      { id: R5, name: 'Veterano', position: 5, managed: false },
      { id: R8, name: 'Booster', position: 8, managed: true },
      { id: R10, name: 'Admin', position: 500, managed: false },
      { id: 'guild-id', name: '@everyone', position: 0, managed: false },
    ],
  });

  assert.equal(roleBlockReason(guild, R5), null, 'cargo normal abaixo do bot');
  assert.match(roleBlockReason(guild, R8), /integração/);
  assert.match(roleBlockReason(guild, R10), /acima do bot/);
  assert.match(roleBlockReason(guild, 'guild-id'), /everyone/);
  assert.match(roleBlockReason(guild, EXTERNO), /não existe mais/);
});

// ---------------------------------------------------------------------------
// syncMemberRewards
// ---------------------------------------------------------------------------

/** Membro de mentira que registra as chamadas em vez de ir à rede. */
function fakeMember(guild, roleIds, { failAdd = false } = {}) {
  const calls = { added: [], removed: [] };
  return {
    guild,
    calls,
    roles: {
      cache: new Collection(roleIds.map((id) => [id, { id }])),
      add: async (ids) => {
        if (failAdd) throw new Error('Missing Permissions');
        calls.added.push(...ids);
      },
      remove: async (ids) => {
        calls.removed.push(...ids);
      },
    },
  };
}

test('syncMemberRewards concede e retira em uma chamada por lote', async () => {
  const config = configWith('stack');
  const guild = fakeGuild({
    roles: [
      { id: R5, name: 'A', position: 1, managed: false },
      { id: R8, name: 'B', position: 2, managed: false },
      { id: R10, name: 'C', position: 3, managed: false },
    ],
  });
  const member = fakeMember(guild, []);

  const result = await syncMemberRewards(member, config, 10);

  assert.deepEqual(result.added.sort(), [R5, R8, R10].sort());
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.problems, []);
  assert.equal(member.calls.added.length, 3);
});

test('cargo inutilizável é relatado em problems, sem quebrar os outros', async () => {
  const config = configWith('stack');
  const guild = fakeGuild({
    roles: [
      { id: R5, name: 'A', position: 1, managed: false },
      { id: R8, name: 'ForaDeAlcance', position: 999, managed: false },
      // R10 nem existe mais.
    ],
  });
  const member = fakeMember(guild, []);

  const result = await syncMemberRewards(member, config, 10);

  assert.deepEqual(result.added, [R5], 'o cargo que dava para conceder foi concedido');
  assert.equal(result.problems.length, 2);
  assert.ok(result.problems.some((p) => /acima do bot/.test(p)));
  assert.ok(result.problems.some((p) => /não existe mais/.test(p)));
});

test('falha da API volta em problems em vez de lançar', async () => {
  const config = configWith('stack');
  const guild = fakeGuild({ roles: [{ id: R5, name: 'A', position: 1, managed: false }] });
  const member = fakeMember(guild, [], { failAdd: true });

  const result = await syncMemberRewards(member, config, 5);

  assert.deepEqual(result.added, []);
  assert.ok(result.problems.some((p) => /falha ao adicionar/.test(p)));
});

test('sem a permissão Gerenciar Cargos o motivo é dito uma vez', async () => {
  const config = configWith('stack');
  const guild = fakeGuild({ roles: [{ id: R5, name: 'A', position: 1, managed: false }], permissions: [] });
  const member = fakeMember(guild, []);

  const result = await syncMemberRewards(member, config, 10);

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.problems, ['o bot não tem a permissão Gerenciar Cargos']);
});

test('sem recompensas configuradas nada é chamado', async () => {
  const guild = fakeGuild();
  const member = fakeMember(guild, [EXTERNO]);

  const result = await syncMemberRewards(member, normalizeConfig({}), 50);

  assert.deepEqual(result, { added: [], removed: [], problems: [] });
  assert.equal(member.calls.added.length, 0);
  assert.equal(member.calls.removed.length, 0);
});
