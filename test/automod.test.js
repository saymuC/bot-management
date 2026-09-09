/**
 * Testes da lógica pura do AutoMod (`node --test test/`).
 *
 * Nada aqui fala com o Discord: os detectores recebem um contexto de mentira com
 * só os campos que eles leem, que é justamente o motivo de o motor montar esse
 * objeto em vez de passar a `Message` adiante.
 *
 * Um bloco no fim toca o banco de verdade (`database/bot.sqlite`) porque
 * `infractions.js` usa statements preparados. Ele grava sob um `guild_id`
 * reservado e apaga tudo no `before` e no `after`, então não encosta nos dados
 * de nenhum servidor real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toPlain,
  toUnmasked,
  matchesTerm,
  capsRatio,
  zalgoRatio,
  countEmojis,
  countSpoilers,
} = require('../utils/automod/textNormalize');
const { compileWildcard, compilePatterns, MAX_SEGMENTS } = require('../utils/automod/wildcard');
const { trackMessage, messageHistory, forgetUser, trackJoin, joinCount, sweep, resetTracker } =
  require('../utils/automod/tracker');
const { ruleDefaults } = require('../config/automodRules');
const { normalizeBool, normalizeList, normalizeLadder, normalizeConfig } = require('../utils/automod/config');
const { detectors: excess, countWrittenMentions, extensionOf } = require('../utils/automod/detectors/excess');
const { detectors: words } = require('../utils/automod/detectors/words');
const { detectors: flood } = require('../utils/automod/detectors/flood');
const { detectors: links, extractDomains, extractInviteCodes, matchesDomain, linkifiable } =
  require('../utils/automod/detectors/links');
const { ladderStep } = require('../utils/automod/infractions');
const { parseDuration, parseLadderLine, isInert } = require('../handlers/automodSetupHandler');

/** Limites de uma regra, com as sobrescritas do teste por cima. */
const limitsOf = (key, overrides = {}) => ({ ...ruleDefaults(key).limits, ...overrides });

// ---------------------------------------------------------------------------

test('toPlain tira acento, caixa e espaço duplicado', () => {
  assert.equal(toPlain('  PÁLÀVRÃ   Composta '), 'palavra composta');
  assert.equal(toPlain(null), '');
});

test('toUnmasked desfaz leetspeak, separadores e repetição', () => {
  assert.equal(toUnmasked('p4l4vr4'), 'palavra');
  assert.equal(toUnmasked('p-a-l-a-v-r-a'), 'palavra');
  assert.equal(toUnmasked('paaalaaavra'), 'palavra');
  assert.equal(toUnmasked('p a l a v r a 🙂'), 'palavra');
});

test('matchesTerm acha a palavra disfarçada', () => {
  for (const variant of ['palavra', 'PALAVRA', 'pálávrá', 'p4l4vr4', 'p.a.l.a.v.r.a', 'paaalavra']) {
    assert.equal(matchesTerm(`olha a ${variant} aqui`, 'palavra'), true, variant);
  }
});

test('matchesTerm com palavra inteira não pega termo curto dentro de palavra inocente', () => {
  // O caso clássico de falso positivo: "sis" está dentro de "assistir".
  assert.equal(matchesTerm('vou assistir o jogo', 'sis', { wholeWord: true }), false);
  // E é curto demais para a forma desmascarada entrar em ação (MIN_UNMASK_LENGTH),
  // que é justamente o que impede o desdisfarce de reintroduzir o falso positivo.
  assert.equal(matchesTerm('vou assistir o jogo', 'sis', { wholeWord: true, unmask: true }), false);
});

test('matchesTerm sem palavra inteira aceita pedaço', () => {
  assert.equal(matchesTerm('vou assistir o jogo', 'sis', { wholeWord: false }), true);
});

test('matchesTerm ignora termo vazio', () => {
  assert.equal(matchesTerm('qualquer coisa', '   '), false);
});

test('matchesTerm trata frase com espaço como sequência literal', () => {
  assert.equal(matchesTerm('compre seguidores agora', 'compre seguidores'), true);
  assert.equal(matchesTerm('compre agora seguidores', 'compre seguidores'), false);
});

test('capsRatio ignora números e pontuação', () => {
  assert.equal(capsRatio('ABC'), 1);
  assert.equal(capsRatio('abc'), 0);
  assert.equal(capsRatio('AB!!! 123'), 1);
  assert.equal(capsRatio('1234!!'), 0);
});

test('zalgoRatio separa texto normal de zalgo', () => {
  assert.ok(zalgoRatio('texto com acentuação normal, é claro') < 0.1);
  assert.ok(zalgoRatio('z̸̧̛a̴̢̛l̵̡̛g̶̨̛ơ̷̢') > 0.3);
});

test('countEmojis conta unicode e personalizado sem confundir o id', () => {
  assert.equal(countEmojis('🙂🙃'), 2);
  assert.equal(countEmojis('<:pepe:123456789012345678>'), 1);
  assert.equal(countEmojis('oi <a:dance:123456789012345678> 🙂'), 2);
  assert.equal(countEmojis('sem emoji nenhum'), 0);
});

test('countSpoilers conta só bloco fechado', () => {
  assert.equal(countSpoilers('||a|| e ||b||'), 2);
  assert.equal(countSpoilers('||aberto'), 0);
});

// ---------------------------------------------------------------------------

test('compileWildcard escapa metacaractere em vez de interpretar', () => {
  const test1 = compileWildcard('a+b');
  assert.equal(test1('a+b'), true);
  // Se fosse regex, "aab" casaria com a+b. Aqui é literal.
  assert.equal(test1('aab'), false);
  assert.equal(compileWildcard('(a)')('texto (a) aqui'), true);
});

test('compileWildcard resolve o curinga em ordem', () => {
  const hit = compileWildcard('ganhe*nitro*gratis');
  assert.equal(hit('ganhe seu nitro de graça? nitro gratis!'), true);
  assert.equal(hit('ganhe nitro'), false);
  // Ordem importa: os segmentos são procurados sempre para a frente.
  assert.equal(hit('gratis nitro ganhe'), false);
});

test('compileWildcard normaliza como o resto do filtro', () => {
  assert.equal(compileWildcard('GRÁTIS')('isso é gratis'), true);
});

test('compileWildcard recusa padrão inútil ou com segmentos demais', () => {
  assert.equal(compileWildcard(''), null);
  assert.equal(compileWildcard('   '), null);
  assert.equal(compileWildcard('***'), null, 'só curinga não filtra nada');
  assert.equal(compileWildcard(Array(MAX_SEGMENTS + 2).fill('x').join('*')), null);
});

test('compileWildcard corta o padrão comprido em vez de recusar', () => {
  // MAX_PATTERN_LENGTH é truncagem, não rejeição: o padrão continua válido,
  // só não olha além do teto.
  const hit = compileWildcard('a'.repeat(500));
  assert.notEqual(hit, null);
  assert.equal(hit('a'.repeat(200)), true);
  assert.equal(hit('a'.repeat(199)), false);
});

test('compileWildcard não explode com padrão hostil', () => {
  // O mesmo padrão como RegExp travaria por backtracking. Aqui o custo é linear.
  const hit = compileWildcard('(a+)+$');
  const started = Date.now();
  assert.equal(hit('a'.repeat(3000)), false);
  assert.ok(Date.now() - started < 500);
});

test('compilePatterns descarta os inválidos e guarda o original', () => {
  const compiled = compilePatterns(['ganhe*nitro', '', '***', null]);
  assert.equal(compiled.length, 1);
  assert.equal(compiled[0].pattern, 'ganhe*nitro');
});

// ---------------------------------------------------------------------------

test('tracker respeita a janela deslizante', () => {
  resetTracker();
  const now = 1_000_000;

  for (let i = 0; i < 5; i += 1) {
    trackMessage('g', 'u', { channelId: 'c', signature: 'oi', at: now - i * 1000 });
  }

  assert.equal(messageHistory('g', 'u', 3000, now).length, 3);
  assert.equal(messageHistory('g', 'u', 10_000, now).length, 5);
  // Bem depois da janela, nada sobra.
  assert.equal(messageHistory('g', 'u', 3000, now + 60_000).length, 0);
});

test('forgetUser zera o histórico de um usuário só', () => {
  resetTracker();
  trackMessage('g', 'u1', { channelId: 'c', signature: 'a', at: 1000 });
  trackMessage('g', 'u2', { channelId: 'c', signature: 'a', at: 1000 });

  forgetUser('g', 'u1');
  assert.equal(messageHistory('g', 'u1', 10_000, 1000).length, 0);
  assert.equal(messageHistory('g', 'u2', 10_000, 1000).length, 1);
});

test('tracker conta entradas e a varredura limpa o que venceu', () => {
  resetTracker();
  const now = 2_000_000;

  trackJoin('g', now);
  trackJoin('g', now - 5000);
  trackJoin('g', now - 60_000);

  assert.equal(joinCount('g', 10_000, now), 2);
  assert.equal(joinCount('g', 120_000, now), 3);
  assert.equal(joinCount('outra', 10_000, now), 0);

  // Uma hora depois tudo saiu da retenção máxima.
  sweep(now + 3_600_000);
  assert.equal(joinCount('g', 600_000, now + 3_600_000), 0);
});

// ---------------------------------------------------------------------------

test('normalizeBool aceita o que o modal produz', () => {
  assert.equal(normalizeBool('sim', false), true);
  assert.equal(normalizeBool('NÃO', true), false);
  assert.equal(normalizeBool('1', false), true);
  assert.equal(normalizeBool('talvez', true), true, 'entrada sem sentido mantém o valor anterior');
  assert.equal(normalizeBool('', false), false);
});

test('normalizeList limpa, deduplica e aceita texto de textarea', () => {
  assert.deepEqual(normalizeList(' A \n b \n\n a '), ['a', 'b']);
  assert.deepEqual(normalizeList(['X', 'x']), ['x']);
  assert.equal(normalizeList(null).length, 0);
});

test('normalizeLadder ordena, deduplica pontos e descarta degrau sem ação', () => {
  const ladder = normalizeLadder([
    { points: 5, action: 'kick' },
    { points: 3, action: 'mute', muteMs: 60_000 },
    { points: 3, action: 'ban' },
    { points: 7, action: 'none' },
    { points: 7, action: 'voar' },
    'lixo',
    null,
  ]);

  assert.deepEqual(ladder.map((step) => step.points), [3, 5]);
  assert.equal(ladder[0].action, 'mute');
  assert.equal(ladder[0].muteMs, 60_000);
});

test('normalizeLadder puxa pontuação fora da faixa para dentro dela', () => {
  // 0 e 999 não são recusados: viram o mínimo e o máximo. Recusar faria o degrau
  // desaparecer sem explicação para quem digitou.
  assert.deepEqual(
    normalizeLadder([{ points: 0, action: 'kick' }, { points: 999, action: 'ban' }]).map((s) => s.points),
    [1, 100]
  );
});

test('normalizeConfig sobrevive a entrada corrompida', () => {
  const config = normalizeConfig({ enabled: 'sim', logChannelId: 'nao-e-id', rules: { caps: 'lixo' } });

  assert.equal(config.enabled, true);
  assert.equal(config.logChannelId, null);
  assert.equal(config.rules.caps.enabled, false);
  assert.equal(config.rules.caps.limits.percent, ruleDefaults('caps').limits.percent);
  assert.equal(config.rules.naoExiste, undefined);
});

test('normalizeConfig prende valor fora da faixa ao limite do catálogo', () => {
  const config = normalizeConfig({ rules: { mentions: { points: 999, limits: { max: 9999 } } } });

  assert.equal(config.rules.mentions.points, 10);
  assert.equal(config.rules.mentions.limits.max, 50);
});

// ---------------------------------------------------------------------------

test('detector caps só vale a partir do mínimo de caracteres', () => {
  const limits = limitsOf('caps', { percent: 70, minLength: 10 });

  assert.equal(excess.caps({ content: 'OK' }, limits), null);
  assert.ok(excess.caps({ content: 'ISSO AQUI É TUDO MAIÚSCULO' }, limits));
  assert.equal(excess.caps({ content: 'isso aqui é tudo minúsculo' }, limits), null);
});

test('detector mentions conta usuário e cargo', () => {
  const limits = limitsOf('mentions', { max: 2 });
  const content = '<@111111111111111111> <@!222222222222222222> <@&333333333333333333>';

  assert.equal(countWrittenMentions(content), 3);
  assert.ok(excess.mentions({ content }, limits));
  assert.equal(excess.mentions({ content: '<@111111111111111111>' }, limits), null);
});

test('detector everyone isenta quem tem a permissão', () => {
  const withPermission = { permissions: { has: () => true } };
  const without = { permissions: { has: () => false } };

  assert.ok(excess.everyone({ content: 'oi @everyone', member: without }));
  assert.equal(excess.everyone({ content: 'oi @everyone', member: withPermission }), null);
  assert.equal(excess.everyone({ content: 'oi pessoal', member: without }), null);
});

test('detector attachmentTypes aceita extensão com e sem ponto', () => {
  assert.equal(extensionOf('virus.EXE'), 'exe');
  assert.equal(extensionOf('sem-extensao'), '');

  const limits = limitsOf('attachmentTypes', { extensions: ['.exe', 'bat'] });
  assert.ok(excess.attachmentTypes({ attachmentNames: ['coisa.exe'] }, limits));
  assert.ok(excess.attachmentTypes({ attachmentNames: ['script.bat'] }, limits));
  assert.equal(excess.attachmentTypes({ attachmentNames: ['foto.png'] }, limits), null);
  assert.equal(excess.attachmentTypes({ attachmentNames: [] }, limits), null);
});

test('detectores lines, emojis, spoilers e zalgo comparam com o limite', () => {
  assert.ok(excess.lines({ content: 'a\nb\nc\nd' }, limitsOf('lines', { max: 3 })));
  assert.equal(excess.lines({ content: 'a\nb\nc' }, limitsOf('lines', { max: 3 })), null);

  assert.ok(excess.emojis({ content: '🙂🙃😀' }, limitsOf('emojis', { max: 2 })));
  assert.ok(excess.spoilers({ content: '||a||||b||' }, limitsOf('spoilers', { max: 1 })));
  assert.ok(excess.zalgo({ content: 'z̸̧̛a̴̢̛l̵̡̛g̶̨̛ơ̷̢' }, limitsOf('zalgo', { percent: 30 })));
  assert.equal(excess.zalgo({ content: 'texto normal com ação' }, limitsOf('zalgo', { percent: 30 })), null);
});

// ---------------------------------------------------------------------------

test('detector words respeita lista vazia e devolve a palavra achada', () => {
  assert.equal(words.words({ content: 'qualquer coisa' }, limitsOf('words')), null);

  const limits = limitsOf('words', { words: ['bobagem'], wholeWord: true, unmask: true });
  const hit = words.words({ content: 'que b0b4gem é essa' }, limits);
  assert.match(hit.detail, /bobagem/);
});

test('detector patterns usa o curinga', () => {
  const limits = limitsOf('patterns', { patterns: ['ganhe*nitro'] });

  assert.ok(words.patterns({ content: 'ganhe agora seu nitro' }, limits));
  assert.equal(words.patterns({ content: 'nitro e depois ganhe' }, limits), null);
  assert.equal(words.patterns({ content: 'ganhe agora seu nitro' }, limitsOf('patterns')), null);
});

// ---------------------------------------------------------------------------

test('linkifiable cola só o ponto disfarçado', () => {
  assert.match(linkifiable('site [.] com'), /site\.com/);
  assert.match(linkifiable('site (ponto) com'), /site\.com/);
  assert.match(linkifiable('hxxps://site.com'), /https:\/\/site\.com/);
  // Ponto de fim de frase não pode virar domínio.
  assert.doesNotMatch(linkifiable('obrigado. com certeza'), /obrigado\.com/);
});

test('extractDomains exige TLD conhecido', () => {
  assert.deepEqual(extractDomains('vai em exemplo.com agora'), ['exemplo.com']);
  assert.deepEqual(extractDomains('olha loja.com.br'), ['loja.com.br']);
  assert.deepEqual(extractDomains('www.exemplo.com'), ['exemplo.com']);
  // Nomes de arquivo e versões não são links.
  assert.deepEqual(extractDomains('abre o index.js da versão 1.2'), []);
});

test('matchesDomain cobre subdomínio', () => {
  assert.equal(matchesDomain('exemplo.com', 'exemplo.com'), true);
  assert.equal(matchesDomain('cdn.exemplo.com', 'exemplo.com'), true);
  assert.equal(matchesDomain('naoexemplo.com', 'exemplo.com'), false);
});

test('detector links: allowlist vazia barra tudo, cheia libera o permitido', () => {
  assert.ok(links.links({ content: 'olha exemplo.com' }, limitsOf('links')));

  const allowed = limitsOf('links', { allowedDomains: ['youtube.com'] });
  assert.equal(links.links({ content: 'veja youtu.be? não: youtube.com/watch' }, allowed), null);
  assert.ok(links.links({ content: 'veja exemplo.com' }, allowed));
  assert.equal(links.links({ content: 'sem link nenhum aqui' }, allowed), null);
});

test('detector blockedDomains vale para subdomínio e ignora lista vazia', () => {
  const limits = limitsOf('blockedDomains', { domains: ['grabify.link'] });

  assert.ok(links.blockedDomains({ content: 'clica em grabify.link/abc' }, limits));
  assert.ok(links.blockedDomains({ content: 'clica em a.grabify.link/abc' }, limits));
  assert.equal(links.blockedDomains({ content: 'clica em grabify.link' }, limitsOf('blockedDomains')), null);
});

test('extractInviteCodes pega os hosts de convite', () => {
  assert.deepEqual(extractInviteCodes('entra em discord.gg/abc123'), ['abc123']);
  assert.deepEqual(extractInviteCodes('discord.com/invite/xyz-789'), ['xyz-789']);
  assert.deepEqual(extractInviteCodes('discord [.] gg/abc123'), ['abc123']);
  assert.deepEqual(extractInviteCodes('nada por aqui'), []);
});

test('detector invites barra sem consultar a API quando o próprio servidor não é exceção', async () => {
  const limits = limitsOf('invites', { allowOwnServer: false });
  const hit = await links.invites({ content: 'discord.gg/abc123', guild: null }, limits);

  assert.match(hit.detail, /abc123/);
  assert.equal(await links.invites({ content: 'sem convite' }, limits), null);
});

// ---------------------------------------------------------------------------

test('detector flood dispara na enésima mensagem da janela', () => {
  resetTracker();
  const now = 3_000_000;
  const ctx = { guild: { id: 'g' }, member: { id: 'u' }, now, signature: 'oi' };
  const limits = limitsOf('flood', { messages: 5, windowSeconds: 5 });

  for (let i = 0; i < 4; i += 1) trackMessage('g', 'u', { channelId: 'c', signature: 'oi', at: now - i * 100 });
  assert.equal(flood.flood(ctx, limits), null, 'quatro mensagens ainda não violam');

  trackMessage('g', 'u', { channelId: 'c', signature: 'oi', at: now });
  assert.ok(flood.flood(ctx, limits), 'a quinta viola');
});

test('detector duplicate ignora mensagem sem texto', () => {
  resetTracker();
  const now = 3_000_000;
  const limits = limitsOf('duplicate', { repeats: 2, windowSeconds: 30 });

  for (let i = 0; i < 2; i += 1) trackMessage('g', 'u', { channelId: 'c', signature: '', at: now });
  assert.equal(
    flood.duplicate({ guild: { id: 'g' }, member: { id: 'u' }, signature: '', now }, limits),
    null,
    'duas fotos sem legenda não são mensagem repetida'
  );

  resetTracker();
  for (let i = 0; i < 2; i += 1) trackMessage('g', 'u', { channelId: 'c', signature: 'spam', at: now });
  assert.ok(flood.duplicate({ guild: { id: 'g' }, member: { id: 'u' }, signature: 'spam', now }, limits));
});

test('detector crosspost conta canais distintos, não mensagens', () => {
  resetTracker();
  const now = 3_000_000;
  const ctx = { guild: { id: 'g' }, member: { id: 'u' }, signature: 'divulgo', now };
  const limits = limitsOf('crosspost', { channels: 3, windowSeconds: 15 });

  for (let i = 0; i < 5; i += 1) trackMessage('g', 'u', { channelId: 'c1', signature: 'divulgo', at: now });
  assert.equal(flood.crosspost(ctx, limits), null, 'cinco vezes no mesmo canal não é spam entre canais');

  trackMessage('g', 'u', { channelId: 'c2', signature: 'divulgo', at: now });
  trackMessage('g', 'u', { channelId: 'c3', signature: 'divulgo', at: now });
  assert.ok(flood.crosspost(ctx, limits));
});

test('detector attachmentSpam soma os anexos da janela', () => {
  resetTracker();
  const now = 3_000_000;
  const ctx = { guild: { id: 'g' }, member: { id: 'u' }, now };
  const limits = limitsOf('attachmentSpam', { attachments: 5, windowSeconds: 10 });

  trackMessage('g', 'u', { channelId: 'c', signature: '', attachments: 2, at: now });
  trackMessage('g', 'u', { channelId: 'c', signature: '', attachments: 2, at: now });
  assert.equal(flood.attachmentSpam(ctx, limits), null);

  trackMessage('g', 'u', { channelId: 'c', signature: '', attachments: 1, at: now });
  assert.ok(flood.attachmentSpam(ctx, limits));
});

// ---------------------------------------------------------------------------

test('ladderStep aplica só o degrau mais alto cruzado', () => {
  const ladder = [
    { points: 3, action: 'mute' },
    { points: 5, action: 'mute' },
    { points: 8, action: 'kick' },
  ];

  assert.equal(ladderStep(ladder, 2), null);
  assert.equal(ladderStep(ladder, 3).action, 'mute');
  assert.equal(ladderStep(ladder, 8).action, 'kick');
  assert.equal(ladderStep(ladder, 100).points, 8);
  assert.equal(ladderStep([], 10), null);
  assert.equal(ladderStep(undefined, 10), null);
});

test('parseDuration entende número solto, unidade e combinação', () => {
  assert.equal(parseDuration('10'), 600_000, 'número puro é lido em minutos');
  assert.equal(parseDuration('10m'), 600_000);
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('  2D  '), 172_800_000);
  assert.equal(parseDuration('abacaxi'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration(null), null);
});

test('parseLadderLine lê "pontos ação duração"', () => {
  assert.deepEqual(parseLadderLine('3 mute 10m'), { points: 3, action: 'mute', muteMs: 600_000 });
  assert.equal(parseLadderLine('8 kick').action, 'kick');
  assert.equal(parseLadderLine('8 voar'), null, 'ação inexistente');
  assert.equal(parseLadderLine('kick 8'), null, 'sem pontos na frente');
  assert.equal(parseLadderLine(''), null);
});

test('isInert aponta a regra ligada que não faz nada', () => {
  assert.equal(isInert({ enabled: true, deleteMessage: false, action: 'none', points: 0 }), true);
  assert.equal(isInert({ enabled: true, deleteMessage: true, action: 'none', points: 0 }), false);
  assert.equal(isInert({ enabled: true, deleteMessage: false, action: 'none', points: 2 }), false);
  assert.equal(isInert({ enabled: false, deleteMessage: false, action: 'none', points: 0 }), false);
});

// ---------------------------------------------------------------------------

/**
 * Estes tocam o SQLite de verdade. O `guild_id` reservado não colide com
 * snowflake do Discord (que tem 17+ dígitos), e o histórico é apagado nas duas
 * pontas para o banco do usuário não guardar sujeira de teste.
 */
test('activePoints soma o que não venceu', async (t) => {
  const { recordInfraction, activePoints, countInfractions, clearInfractions } =
    require('../utils/automod/infractions');

  const guildId = 'test-automod';
  const userId = 'test-user';

  clearInfractions(guildId, userId);
  t.after(() => clearInfractions(guildId, userId));

  recordInfraction({ guildId, userId, ruleKey: 'caps', points: 2, reason: 'teste' });
  recordInfraction({ guildId, userId, ruleKey: 'links', points: 3, reason: 'teste' });

  assert.equal(countInfractions(guildId, userId), 2);
  assert.equal(activePoints(guildId, userId, 168), 5);
  assert.equal(activePoints(guildId, userId, 0), 5, 'expiração 0 = pontos eternos');

  // Uma semana no futuro, tudo já venceu — mas as linhas continuam lá.
  const future = Date.now() + 8 * 24 * 3600 * 1000;
  assert.equal(activePoints(guildId, userId, 168, future), 0);
  assert.equal(countInfractions(guildId, userId), 2);
});
