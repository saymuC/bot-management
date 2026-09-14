/**
 * Testes da observabilidade.
 *
 * O que precisa continuar verdade: erro contado por escopo (é o "está piorando?"),
 * segredo nunca vai para o log, e o retrato de saúde não explode sem client — é
 * justamente com o gateway caído que alguém vai bater no /health.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { logError, errorStats, resetErrorStats, healthSnapshot, formatUptime, RECENT_LIMIT } = require('../utils/observability');

/** Roda `fn` sem sujar a saída do test runner. */
function quiet(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

test('conta erros por escopo e guarda os últimos', () => {
  resetErrorStats();

  quiet(() => {
    logError('tickets', new Error('falhou'), { guildId: '1' });
    logError('tickets', 'string também vale');
    logError('levels', new Error('outro'));
  });

  const stats = errorStats();
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.byScope, { tickets: 2, levels: 1 });
  assert.equal(stats.recent[0].scope, 'levels', 'o mais recente vem primeiro');
  assert.equal(stats.recent.length, 3);
});

test(`a lista recente para em ${RECENT_LIMIT}`, () => {
  resetErrorStats();
  quiet(() => {
    for (let i = 0; i < RECENT_LIMIT + 5; i += 1) logError('loop', new Error(`erro ${i}`));
  });

  const stats = errorStats();
  assert.equal(stats.total, RECENT_LIMIT + 5, 'o total conta tudo, só a lista é limitada');
  assert.equal(stats.recent.length, RECENT_LIMIT);
  assert.equal(stats.recent[0].message, `erro ${RECENT_LIMIT + 4}`);
});

test('não loga campo sensível e recorta valor gigante', () => {
  resetErrorStats();

  const linhas = [];
  const original = console.error;
  console.error = (line) => linhas.push(String(line));
  try {
    logError('oauth', new Error('token inválido'), {
      accessToken: 'segredo-nao-pode-aparecer',
      Authorization: 'Bearer abc',
      guildId: '42',
      conteudo: 'x'.repeat(1000),
      vazio: null,
    });
  } finally {
    console.error = original;
  }

  const json = JSON.parse(linhas[0].replace('[error] ', ''));
  assert.deepEqual(Object.keys(json.context), ['guildId', 'conteudo']);
  assert.equal(json.context.conteudo.length, 300);
  assert.equal(json.scope, 'oauth');
  assert.equal(json.message, 'token inválido');
});

test('o contador não é alterado por quem lê', () => {
  resetErrorStats();
  quiet(() => logError('x', new Error('a')));

  const stats = errorStats();
  stats.total = 999;
  stats.byScope.x = 999;
  stats.recent.pop();

  assert.equal(errorStats().total, 1);
  assert.deepEqual(errorStats().byScope, { x: 1 });
  assert.equal(errorStats().recent.length, 1);
});

test('healthSnapshot sem client responde "não pronto" em vez de quebrar', () => {
  const snapshot = healthSnapshot(null);

  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.discord.guilds, 0);
  assert.equal(snapshot.discord.latencyMs, null);
  assert.ok(snapshot.memory.rssMb > 0);
  assert.ok(snapshot.uptime.ms >= 0);
  assert.equal(typeof snapshot.uptime.human, 'string');
});

test('healthSnapshot lê guilds, latência e membros do client', () => {
  const guilds = [
    { memberCount: 10 },
    { memberCount: 5 },
  ];
  const client = {
    isReady: () => true,
    ws: { ping: 42.6 },
    uptime: 1234,
    user: { tag: 'bot#0001' },
    guilds: { cache: { size: 2, reduce: (fn, init) => guilds.reduce(fn, init) } },
    channels: { cache: { size: 7 } },
  };

  const snapshot = healthSnapshot(client);
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.discord.guilds, 2);
  assert.equal(snapshot.discord.channels, 7);
  assert.equal(snapshot.discord.cachedMembers, 15);
  assert.equal(snapshot.discord.latencyMs, 43);
  assert.equal(snapshot.uptime.gatewayMs, 1234);
});

test('formatUptime omite unidades zeradas', () => {
  assert.equal(formatUptime(0), '0s');
  assert.equal(formatUptime(-500), '0s');
  assert.equal(formatUptime(8_000), '8s');
  assert.equal(formatUptime(3_600_000), '1h');
  assert.equal(formatUptime(190_388_000), '2d 4h 53m 8s');
});
