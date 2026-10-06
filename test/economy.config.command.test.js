const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { db } = require('../database/db');
const { routeEconomyConfig, buildEconomyPanel } = require('../handlers/economyHandler');
const { getEconomyConfig } = require('../config/economy');

const ID = 'test-economy-panel';
const guild = { id: ID, name: 'Testes' };
test.after(() => db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(ID));

test('painel recusa clique sem permissão e não salva', async () => {
  const interaction = {
    guild, guildId: ID, user: { id: 'user' }, memberPermissions: { has: () => false },
    customId: 'eco_cfg_toggle', isButton: () => true,
    reply: async (payload) => { assert.equal(payload.flags, 64); },
    update: () => assert.fail('Não deve atualizar'),
  };
  await routeEconomyConfig(interaction);
  assert.equal(getEconomyConfig(ID).enabled, true);
});

test('painel autoriza admin, mostra modal e salva recompensas', async () => {
  const interaction = {
    guild, guildId: ID, user: { id: 'user' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    customId: 'eco_cfg_rewards', isButton: () => true,
    showModal: async (modal) => {
      assert.equal(modal.toJSON().components.length, 5);
      assert.equal(modal.toJSON().custom_id, 'eco_cfg_submit_rewards');
    },
  };
  await routeEconomyConfig(interaction);
  await routeEconomyConfig({ ...interaction, customId: 'eco_cfg_submit_rewards', isButton: () => false,
    isModalSubmit: () => true, isFromMessage: () => true,
    fields: { getTextInputValue: (key) => ({ dailyMin: '301', dailyMax: '401', workMin: '151', workMax: '251', workCooldownMinutes: '45' })[key] },
    update: async (payload) => assert.match(payload.embeds[0].toJSON().fields[2].value, /301 a 401/),
  });
  assert.equal(getEconomyConfig(ID).workCooldownMinutes, 45);
  assert.equal(buildEconomyPanel(guild).components.length, 2);
  assert.equal(buildEconomyPanel(guild).components[1].components[0].custom_id, 'eco_cfg_close');
});

test('modal inválido responde sem alterar valores e toggle muda o status', async () => {
  const base = { guild, guildId: ID, user: { id: 'user' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator } };
  await routeEconomyConfig({ ...base, customId: 'eco_cfg_submit_rewards', isButton: () => false,
    isModalSubmit: () => true,
    fields: { getTextInputValue: (key) => ({ dailyMin: '500', dailyMax: '100', workMin: '151', workMax: '251', workCooldownMinutes: '45' })[key] },
    reply: async (payload) => assert.equal(payload.flags, 64),
  });
  assert.equal(getEconomyConfig(ID).dailyMin, 301);
  await routeEconomyConfig({ ...base, customId: 'eco_cfg_toggle', isButton: () => true,
    update: async (payload) => assert.match(payload.embeds[0].toJSON().fields[0].value, /Desativada/),
  });
  assert.equal(getEconomyConfig(ID).enabled, false);
});

test('fechar painel retira os controles', async () => {
  await routeEconomyConfig({ guild, guildId: ID, user: { id: 'user' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    customId: 'eco_cfg_close', isButton: () => true,
    update: async (payload) => assert.deepEqual(payload.components, []),
  });
});
