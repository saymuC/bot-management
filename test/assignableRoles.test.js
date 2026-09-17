const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');

const { roleBlockReason, validateAssignableRole } = require('../utils/assignableRoles');

const GUILD_ID = '900000000000000000';
const OWNER_ID = '900000000000000001';
const USER_ID = '900000000000000002';

function role({ id = '900000000000000010', name = 'Cargo', position = 1, managed = false, permissions = [] } = {}) {
  return {
    id,
    name,
    position,
    managed,
    permissions: { has: (permission) => permissions.includes(permission) },
    toString: () => `<@&${id}>`,
  };
}

function interaction({ selected = role(), memberPosition = 50, botPosition = 100, owner = false } = {}) {
  return {
    guild: {
      id: GUILD_ID,
      ownerId: OWNER_ID,
      roles: { everyone: { id: GUILD_ID } },
      members: { me: { roles: { highest: { position: botPosition } } } },
    },
    member: {
      id: owner ? OWNER_ID : USER_ID,
      roles: { highest: { position: memberPosition } },
    },
    selected,
  };
}

test('validateAssignableRole bloqueia cargo acima do executor mesmo abaixo do bot', () => {
  const selected = role({ position: 80 });
  const i = interaction({ selected, memberPosition: 50, botPosition: 100 });

  assert.match(validateAssignableRole(i, selected), /abaixo do seu cargo mais alto/);
});

test('validateAssignableRole bloqueia cargo com permissões perigosas', () => {
  const selected = role({ permissions: [PermissionFlagsBits.Administrator] });
  const i = interaction({ selected });

  assert.match(validateAssignableRole(i, selected), /permissões administrativas/);
});

test('validateAssignableRole permite cargo comum abaixo do executor e do bot', () => {
  const selected = role({ position: 10 });
  const i = interaction({ selected, memberPosition: 50, botPosition: 100 });

  assert.equal(validateAssignableRole(i, selected), null);
});

test('roleBlockReason bloqueia recompensas com permissões perigosas', () => {
  const selected = role({ name: 'Admin', permissions: [PermissionFlagsBits.ManageRoles] });
  const guild = {
    id: GUILD_ID,
    roles: { everyone: { id: GUILD_ID }, cache: new Map([[selected.id, selected]]) },
    members: { me: { roles: { highest: { position: 100 } } } },
  };

  assert.match(roleBlockReason(guild, selected.id), /permissões administrativas/);
});
