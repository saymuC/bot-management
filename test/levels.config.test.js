/**
 * Testes do normalizador da config de Levels.
 *
 * O contrato que importa: `normalizeConfig` **nunca lança**. Ela é a porta entre
 * um JSON numa coluna de texto (que pode ter sido escrito por uma versão antiga
 * do bot, ou editado à mão) e o motor que roda em toda mensagem. Lançar aqui
 * significaria um servidor onde o painel não abre para consertar a config.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');

const { DEFAULT_CONFIG, LIMITS } = require('../config/levels');
const {
  normalizeConfig,
  normalizeRewards,
  normalizeIds,
  normalizeBool,
  normalizeBackgroundUrl,
  normalizeHeadline,
  isChannelIgnored,
  isMemberIgnored,
} = require('../utils/levels/config');

const ROLE_A = '100000000000000001';
const ROLE_B = '100000000000000002';
const CHANNEL = '200000000000000001';
const CATEGORY = '200000000000000009';

test('entrada vazia devolve exatamente os defaults', () => {
  const config = normalizeConfig({});
  assert.equal(config.enabled, DEFAULT_CONFIG.enabled);
  assert.equal(config.xpMin, 15);
  assert.equal(config.xpMax, 25);
  assert.equal(config.cooldownSeconds, 60);
  assert.equal(config.minUsefulChars, 5);
  assert.equal(config.repeatWindowSeconds, 300);
  assert.equal(config.announceEnabled, true);
  assert.equal(config.announceChannelId, null);
  assert.equal(config.rewardMode, 'stack');
  assert.deepEqual(config.rewards, []);
  assert.deepEqual(config.ignoredChannelIds, []);
});

test('o sistema nasce desligado', () => {
  // Instalar uma versão nova do bot não pode começar a distribuir cargos sem
  // ninguém ter pedido.
  assert.equal(normalizeConfig({}).enabled, false);
});

test('entradas absurdas não lançam e caem em valores utilizáveis', () => {
  for (const raw of [null, undefined, 0, 'texto', [], true, { xpMin: {}, rewards: 'x' }]) {
    const config = normalizeConfig(raw);
    assert.equal(typeof config.xpMin, 'number');
    assert.ok(Array.isArray(config.rewards));
  }
});

test('valores fora da faixa são grudados no limite mais próximo', () => {
  const config = normalizeConfig({
    xpMin: -10,
    xpMax: 999_999,
    cooldownSeconds: 1,
    minUsefulChars: 500,
    repeatWindowSeconds: 99_999,
  });

  assert.equal(config.xpMin, LIMITS.xp.min);
  assert.equal(config.xpMax, LIMITS.xp.max);
  assert.equal(config.cooldownSeconds, LIMITS.cooldownSeconds.min);
  assert.equal(config.minUsefulChars, LIMITS.minUsefulChars.max);
  assert.equal(config.repeatWindowSeconds, LIMITS.repeatWindowSeconds.max);
});

test('xpMin > xpMax sobe o máximo em vez de zerar os dois', () => {
  // O admin digitou 40 no mínimo de propósito; o 20 no máximo é o valor velho.
  // Preservar o mínimo perde o dado errado, não o certo.
  const config = normalizeConfig({ xpMin: 40, xpMax: 20 });
  assert.equal(config.xpMin, 40);
  assert.equal(config.xpMax, 40);
});

test('janela de repetição 0 é aceita (desliga a trava)', () => {
  assert.equal(normalizeConfig({ repeatWindowSeconds: 0 }).repeatWindowSeconds, 0);
});

test('ids são deduplicados, validados e limitados', () => {
  const config = normalizeConfig({
    ignoredChannelIds: [CHANNEL, CHANNEL, 'nao-é-id', '12', null, CATEGORY],
    ignoredRoleIds: Array.from({ length: LIMITS.ignoredRoles + 20 }, (_, i) => String(100000000000000000n + BigInt(i))),
  });

  assert.deepEqual(config.ignoredChannelIds, [CHANNEL, CATEGORY]);
  assert.equal(config.ignoredRoleIds.length, LIMITS.ignoredRoles);
});

test('normalizeIds aceita número como id, mas não como número', () => {
  // Snowflake nunca é tratado como número no projeto; a coerção é só para
  // tolerar um JSON antigo que gravou o id sem as quotas.
  assert.deepEqual(normalizeIds([100000000000000001n.toString()], 5), [ROLE_A]);
  assert.deepEqual(normalizeIds([1, 2, 3], 5), []);
});

test('normalizeBool entende as formas que os modais produzem', () => {
  assert.equal(normalizeBool('sim', false), true);
  assert.equal(normalizeBool('NÃO', true), false);
  assert.equal(normalizeBool('1', false), true);
  assert.equal(normalizeBool('desligado', true), false);
  assert.equal(normalizeBool('talvez', true), true, 'texto irreconhecível mantém o valor atual');
  assert.equal(normalizeBool('', false), false);
});

test('rewardMode inválido volta ao padrão', () => {
  assert.equal(normalizeConfig({ rewardMode: 'inventado' }).rewardMode, 'stack');
  assert.equal(normalizeConfig({ rewardMode: 'highest' }).rewardMode, 'highest');
  assert.equal(normalizeConfig({ rewardMode: null }).rewardMode, 'stack');
});

test('recompensas saem ordenadas por nível', () => {
  const rewards = normalizeRewards([
    { level: 20, roleIds: [ROLE_B] },
    { level: 5, roleIds: [ROLE_A] },
  ]);
  assert.deepEqual(
    rewards.map((r) => r.level),
    [5, 20]
  );
});

test('um nível pode conceder vários cargos', () => {
  const [reward] = normalizeRewards([{ level: 5, roleIds: [ROLE_A, ROLE_B] }]);
  assert.deepEqual(reward.roleIds, [ROLE_A, ROLE_B]);
});

test('nível duplicado é mesclado, não descartado', () => {
  // Duas entradas para o nível 5 quase sempre significam "quero estes dois
  // cargos no 5". Perder a segunda em silêncio seria a leitura errada.
  const rewards = normalizeRewards([
    { level: 5, roleIds: [ROLE_A] },
    { level: 5, roleIds: [ROLE_B, ROLE_A] },
  ]);

  assert.equal(rewards.length, 1);
  assert.deepEqual(rewards[0].roleIds, [ROLE_A, ROLE_B]);
});

test('recompensa sem cargo válido ou sem nível é descartada', () => {
  const rewards = normalizeRewards([
    { level: 5, roleIds: [] },
    { level: 0, roleIds: [ROLE_A] },
    { level: 5, roleIds: ['lixo'] },
    { roleIds: [ROLE_A] },
    null,
    'x',
  ]);
  assert.deepEqual(rewards, []);
});

test('o formato antigo roleId continua sendo lido', () => {
  const [reward] = normalizeRewards([{ level: 3, roleId: ROLE_A }]);
  assert.deepEqual(reward, { level: 3, roleIds: [ROLE_A] });
});

test('isChannelIgnored cobre o canal, a categoria e o tópico', () => {
  const config = normalizeConfig({ ignoredChannelIds: [CATEGORY] });

  assert.equal(isChannelIgnored(config, { id: CATEGORY, parentId: null }), true, 'a própria categoria');
  assert.equal(isChannelIgnored(config, { id: CHANNEL, parentId: CATEGORY }), true, 'canal dentro dela');
  assert.equal(isChannelIgnored(config, { id: CHANNEL, parentId: null }), false, 'canal de fora');
  assert.equal(isChannelIgnored(config, null), false);
  assert.equal(isChannelIgnored(normalizeConfig({}), { id: CHANNEL }), false, 'sem exclusões, nada é ignorado');
});

test('isMemberIgnored olha os cargos do membro', () => {
  const config = normalizeConfig({ ignoredRoleIds: [ROLE_A] });
  // `Collection`, e não `Map`, porque é o que o discord.js entrega em
  // `member.roles.cache` — e é dela que vem o `.some` que a função usa.
  const rolesOf = (...ids) => ({ roles: { cache: new Collection(ids.map((id) => [id, { id }])) } });
  const memberWith = rolesOf(ROLE_A);
  const memberWithout = rolesOf(ROLE_B);

  assert.equal(isMemberIgnored(config, memberWith), true);
  assert.equal(isMemberIgnored(config, memberWithout), false);
  assert.equal(isMemberIgnored(config, null), false);
  assert.equal(isMemberIgnored(normalizeConfig({}), memberWith), false);
});

// ---------------------------------------------------------------------------
// Aparência: fundo por URL e frase do topo
// ---------------------------------------------------------------------------

test('normalizeBackgroundUrl só aceita https em endereço público', () => {
  assert.equal(
    normalizeBackgroundUrl('https://cdn.exemplo.com/fundo.png'),
    'https://cdn.exemplo.com/fundo.png',
    'https em domínio público passa'
  );

  // Cada uma destas seria um pedido que o bot faria sozinho a cada `/top`, e a
  // config é o lugar onde ele é recusado — não a hora do download.
  assert.equal(normalizeBackgroundUrl('http://cdn.exemplo.com/fundo.png'), null, 'http sem TLS');
  assert.equal(normalizeBackgroundUrl('https://127.0.0.1/fundo.png'), null, 'IPv4 literal');
  assert.equal(normalizeBackgroundUrl('https://[::1]/fundo.png'), null, 'IPv6 literal');
  assert.equal(normalizeBackgroundUrl('https://localhost/fundo.png'), null, 'localhost');
  assert.equal(normalizeBackgroundUrl('https://cofre.internal/fundo.png'), null, 'sufixo interno');
  assert.equal(normalizeBackgroundUrl('ftp://exemplo.com/fundo.png'), null, 'protocolo estranho');
  assert.equal(normalizeBackgroundUrl('não é url'), null, 'texto solto');

  assert.equal(normalizeBackgroundUrl(''), null, 'vazio é "sem fundo", não erro');
  assert.equal(normalizeBackgroundUrl('   '), null);
  assert.equal(normalizeBackgroundUrl(null), null);
  assert.equal(normalizeBackgroundUrl(undefined), null);
});

test('normalizeHeadline corta, achata espaços e trata vazio como ausência', () => {
  assert.equal(normalizeHeadline('  Quem mais conversou  '), 'Quem mais conversou');

  // O modal do Discord aceita Enter num campo curto; a frase é uma linha só na
  // imagem, então a quebra virá espaço em vez de invalidar a config inteira.
  assert.equal(normalizeHeadline('duas\nlinhas'), 'duas linhas');
  assert.equal(normalizeHeadline('muitos     espaços'), 'muitos espaços');

  const long = 'a'.repeat(LIMITS.headlineChars + 40);
  assert.equal(normalizeHeadline(long).length, LIMITS.headlineChars, 'cortada no limite');

  assert.equal(normalizeHeadline(''), null);
  assert.equal(normalizeHeadline('   \n  '), null, 'só espaço não é frase');
  assert.equal(normalizeHeadline(null), null);
});

test('normalizeConfig aplica a aparência junto do resto', () => {
  const config = normalizeConfig({
    backgroundUrl: 'https://exemplo.com/a.png',
    headline: '  frase  ',
  });
  assert.equal(config.backgroundUrl, 'https://exemplo.com/a.png');
  assert.equal(config.headline, 'frase');

  const rejected = normalizeConfig({ backgroundUrl: 'http://exemplo.com/a.png' });
  assert.equal(rejected.backgroundUrl, DEFAULT_CONFIG.backgroundUrl);
  assert.equal(rejected.headline, DEFAULT_CONFIG.headline);
});
