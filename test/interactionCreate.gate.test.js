/**
 * Gate de permissão do roteador de slash commands.
 *
 * O ponto do teste é o `execute` **não** rodar: um gate que recusa depois de o
 * comando já ter banido alguém não é um gate.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const interactionCreate = require('../events/interactionCreate');
const { setCommandOverride, setGroupRoles } = require('../utils/commandPermissions');

const STAFF_ROLE = '850000000000000010';

let seq = 0;
const nextGuildId = () => `86000000000000${String(++seq).padStart(4, '0')}`;

function scenario({ commandName = 'ban', roleIds = [], legacy = [], guildId = nextGuildId() } = {}) {
  const state = { executed: false, replies: [], deferred: false };

  const command = {
    ephemeral: false,
    permissionGroup: 'moderation',
    requiredPermission: PermissionFlagsBits.BanMembers,
    data: { name: commandName },
    execute: async () => {
      state.executed = true;
    },
  };

  const interaction = {
    guildId,
    guild: { id: guildId, ownerId: '850000000000000099', name: 'Servidor' },
    user: { id: '850000000000000002' },
    member: { id: '850000000000000002', roles: { cache: new Set(roleIds) } },
    memberPermissions: { has: (permission) => legacy.includes(permission) },
    commandName,
    createdTimestamp: Date.now(),
    isAutocomplete: () => false,
    isChatInputCommand: () => true,
    deferReply: async () => {
      state.deferred = true;
    },
    reply: async (payload) => state.replies.push(payload),
    editReply: async (payload) => state.replies.push(payload),
  };

  const client = { commands: { get: () => command } };
  return { state, interaction, client, guildId };
}

test('sem permissão o comando não executa e a recusa é efêmera', async () => {
  const { state, interaction, client } = scenario();

  await interactionCreate.execute(interaction, client);

  assert.equal(state.executed, false);
  assert.equal(state.deferred, false, 'não deve deferir uma resposta que será recusada');
  assert.equal(state.replies.length, 1);
  assert.equal(state.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(state.replies[0].embeds[0].data.description, /Você não tem permissão para usar este comando\./);
});

test('cargo autorizado pelo grupo executa o comando', async () => {
  const guildId = nextGuildId();
  setGroupRoles(guildId, 'moderation', [STAFF_ROLE]);
  const { state, interaction, client } = scenario({ roleIds: [STAFF_ROLE], guildId });

  await interactionCreate.execute(interaction, client);

  assert.equal(state.executed, true);
  assert.equal(state.deferred, true);
});

test('permissão nativa antiga continua valendo sem configuração', async () => {
  const { state, interaction, client } = scenario({ legacy: [PermissionFlagsBits.BanMembers] });

  await interactionCreate.execute(interaction, client);

  assert.equal(state.executed, true);
});

test('admin_only barra o cargo do grupo antes de executar', async () => {
  const guildId = nextGuildId();
  setGroupRoles(guildId, 'moderation', [STAFF_ROLE]);
  setCommandOverride(guildId, 'ban', { mode: 'admin_only' });
  const { state, interaction, client } = scenario({ roleIds: [STAFF_ROLE], guildId });

  await interactionCreate.execute(interaction, client);

  assert.equal(state.executed, false);
});
