const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits } = require('discord.js');

const { getGuildConfig } = require('../database/db');
const { centerPayload, routeConfigCenter } = require('../handlers/configCenterHandler');

const GUILD = '900000000000000000';
const LOG_CHANNEL = '900000000000000001';

function fakeGuild() {
  const channel = { id: LOG_CHANNEL, name: 'logs', toString: () => `<#${LOG_CHANNEL}>` };
  return {
    id: GUILD,
    name: 'Servidor de Teste',
    channels: { cache: new Collection([[channel.id, channel]]) },
    roles: { cache: new Collection() },
    emojis: { cache: new Collection() },
    members: { me: { roles: { highest: { position: 100 } }, permissions: { has: () => true } } },
  };
}

function fakeMember(guild) {
  return {
    guild,
    permissions: { has: () => false },
    roles: { cache: new Collection() },
    displayName: 'Admin',
    user: { id: '900000000000000002', username: 'Admin', displayAvatarURL: () => 'https://example.com/avatar.png' },
  };
}

function interaction({ customId = 'config_open', values = ['logs'], admin = true, channels = [] } = {}) {
  const guild = fakeGuild();
  const calls = [];
  const i = {
    customId,
    values,
    guild,
    guildId: guild.id,
    member: fakeMember(guild),
    channelId: LOG_CHANNEL,
    createdTimestamp: Date.now(),
    memberPermissions: { has: (permission) => admin && permission === PermissionFlagsBits.Administrator },
    channels: { first: () => channels[0] ?? null },
    update: async (payload) => {
      calls.push({ method: 'update', payload });
    },
    reply: async (payload) => {
      calls.push({ method: 'reply', payload });
    },
  };
  i.calls = calls;
  return i;
}

const rows = (payload) => payload.components.map((row) => row.toJSON());

test('central mostra as seis opções combinadas', () => {
  const payload = centerPayload(fakeGuild());
  const select = rows(payload)[0].components[0];

  assert.equal(payload.embeds[0].data.title, '⚙️ Central de Configuração');
  assert.deepEqual(
    select.options.map((option) => option.value),
    ['verify', 'logs', 'tickets', 'automod', 'welcome', 'levels']
  );
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('selecionar logs troca para seletor de canal de texto', async () => {
  const i = interaction({ values: ['logs'] });
  await routeConfigCenter(i);

  const [call] = i.calls;
  assert.equal(call.method, 'update');
  assert.equal(call.payload.embeds[0].data.title, '📜 Configuração de logs');

  const select = rows(call.payload)[0].components[0];
  assert.equal(select.custom_id, 'config_logs-channel');
  assert.deepEqual(select.channel_types, [0]);
});

test('selecionar cada painel abre o payload existente', async () => {
  const expected = {
    verify: 'Painel de verificação',
    tickets: 'Configuração dos tickets',
    automod: 'Painel do AutoMod',
    welcome: 'Painel de boas-vindas',
    levels: 'Configuração de níveis e XP',
  };

  for (const [value, marker] of Object.entries(expected)) {
    const i = interaction({ values: [value] });
    await routeConfigCenter(i);

    assert.equal(i.calls[0].method, 'update', value);
    assert.match(`${i.calls[0].payload.content ?? ''} ${i.calls[0].payload.embeds[0].data.title}`, new RegExp(marker), value);
  }
});

test('selecionar canal de logs salva na hora e limpa componentes', async () => {
  const channel = { id: LOG_CHANNEL, toString: () => `<#${LOG_CHANNEL}>` };
  const i = interaction({ customId: 'config_logs-channel', channels: [channel] });

  await routeConfigCenter(i);

  assert.equal(getGuildConfig(GUILD).log_channel_id, LOG_CHANNEL);
  assert.equal(i.calls[0].method, 'update');
  assert.equal(i.calls[0].payload.components.length, 0);
  assert.match(i.calls[0].payload.embeds[0].data.description, /Canal de logs definido/);
});

test('não administrador recebe aviso claro', async () => {
  const i = interaction({ admin: false });

  await routeConfigCenter(i);

  assert.equal(i.calls[0].method, 'reply');
  assert.match(i.calls[0].payload.embeds[0].data.description, /Você precisa ser administrador/);
});
