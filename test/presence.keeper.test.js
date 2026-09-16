/**
 * O guardião existe por um motivo só: reconexão zera a presença do lado do
 * Discord. Se ele parar de reaplicar no `shardResume`, o status desaparece
 * sozinho depois de horas no ar — e ninguém liga o sintoma à causa.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Events } = require('discord.js');
const { startPresenceKeeper, setDesiredPresence } = require('../utils/presenceKeeper');
const { resolvePresenceTemplates } = require('../utils/presence');

test('reaplica a presença no boot e em cada reconexão', () => {
  const sent = [];
  const client = new EventEmitter();
  client.user = { setPresence: (data) => sent.push(data) };

  startPresenceKeeper(client);
  assert.equal(sent.length, 1, 'devia aplicar no boot');

  const manual = setDesiredPresence(client, { status: 'dnd', activity: 'watching', name: 'vários servers' });
  assert.equal(manual.status, 'dnd');
  assert.equal(sent.length, 2, 'a alteração manual aplica na hora');

  client.emit(Events.ShardResume);
  assert.deepEqual(sent.at(-1), sent.at(-2), 'a reconexão reaplica o último status pedido');

  // O refresh periódico não pode segurar o event loop: sem `unref()` a suíte
  // trava no CI até o timeout do job.
  assert.ok(
    !process.getActiveResourcesInfo().includes('Timeout'),
    'o timer de refresh precisa estar unref()',
  );
});

test('placeholders usam cache atual, toleram cache vazio e preservam desconhecidos', () => {
  const client = {
    guilds: { cache: new Map([['1', { memberCount: 10 }], ['2', { memberCount: 5 }]]) },
    shard: { ids: [3], count: 8 },
  };

  assert.deepEqual(resolvePresenceTemplates(client, {
    status: 'online',
    activity: 'watching',
    name: '{guilds}/{servers} servidores',
    state: '{users}/{members} usuários no cluster {cluster} {x}',
  }), {
    status: 'online',
    activity: 'watching',
    name: '2/2 servidores',
    state: '15/15 usuários no cluster 3/8 {x}',
    url: null,
  });

  const empty = resolvePresenceTemplates({}, { name: '{guilds} {users} {cluster}', state: '{missing}' });
  assert.equal(empty.name, '0 0 ');
  assert.equal(empty.state, '{missing}');
});

test('texto resolvido continua limitado a 128 caracteres', () => {
  const long = `${'x'.repeat(60)}${'{users}'.repeat(9)}`;
  const resolved = resolvePresenceTemplates({ guilds: { cache: new Map([['1', { memberCount: 1234567890 }]]) } }, { name: long, state: long });

  assert.equal(resolved.name.length, 128);
  assert.equal(resolved.state.length, 128);
});

test('refresh periódico só envia quando o valor resolvido muda', () => {
  const sent = [];
  const timers = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = (fn) => {
    timers.push(fn);
    return { unref() {} };
  };

  const client = new EventEmitter();
  client.user = { setPresence: (data) => sent.push(data) };
  client.guilds = { cache: new Map([['1', { memberCount: 1 }]]) };

  try {
    startPresenceKeeper(client);
    setDesiredPresence(client, { status: 'online', activity: 'watching', name: '{users}' });
    const before = sent.length;
    timers.at(-1)();
    assert.equal(sent.length, before, 'sem mudança não reenviar');

    client.guilds.cache.get('1').memberCount = 2;
    timers.at(-1)();
    assert.equal(sent.length, before + 1, 'valor novo reaplica');
  } finally {
    global.setInterval = originalSetInterval;
  }
});

test('startPresenceKeeper não duplica listeners nem timers', () => {
  const timers = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = (fn) => {
    timers.push(fn);
    return { unref() {} };
  };

  const client = new EventEmitter();
  client.user = { setPresence: () => {} };
  client.guilds = { cache: new Map() };

  try {
    startPresenceKeeper(client);
    startPresenceKeeper(client);
    assert.equal(client.listenerCount(Events.ShardReady), 1);
    assert.equal(client.listenerCount(Events.ShardResume), 1);
    assert.equal(timers.length, 1);
  } finally {
    global.setInterval = originalSetInterval;
  }
});

test('sem client.user, setDesiredPresence não troca a fonte da verdade', () => {
  const sent = [];
  const client = new EventEmitter();
  client.user = { setPresence: (data) => sent.push(data) };

  setDesiredPresence(client, { status: 'online', activity: 'watching', name: 'anterior' });
  client.user = null;
  assert.equal(setDesiredPresence(client, { status: 'dnd', activity: 'watching', name: 'nova' }), null);
  client.user = { setPresence: (data) => sent.push(data) };
  client.emit(Events.ShardResume);

  assert.equal(sent.at(-1).activities[0].name, 'anterior');
});
