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
const {
  RULES,
  ruleDefaults,
  BASE_DEFAULTS,
  NOTICE_TTL_CHOICES,
  MIN_NOTICE_TTL_MS,
  MAX_NOTICE_TTL_MS,
} = require('../config/automodRules');
const {
  normalizeBool,
  normalizeList,
  normalizeLadder,
  normalizeNoticeTtl,
  normalizeConfig,
  watchesChannel,
} = require('../utils/automod/config');
const {
  detectors: excess,
  countWrittenMentions,
  extensionOf,
} = require('../utils/automod/detectors/excess');
const { detectors: media, classifyAttachment, findMediaLink } = require('../utils/automod/detectors/media');
const { detectors: words } = require('../utils/automod/detectors/words');
const { detectors: flood } = require('../utils/automod/detectors/flood');
const { detectors: links, extractDomains, extractInviteCodes, matchesDomain, linkifiable } =
  require('../utils/automod/detectors/links');
const { ladderStep, crossedStep } = require('../utils/automod/infractions');
const { pickAction, noticeText, canNotify, NOTICE_COOLDOWN_MS } = require('../utils/automod/enforce');
const { parseDuration, parseLadderLine, isInert, idleReason } = require('../handlers/automodSetupHandler');
const { markHandled, wasHandled, HANDLED_TTL_MS } = require('../handlers/automodHandler');

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

test('aviso no canal não se apaga por padrão', () => {
  // O padrão é ficar: uma mensagem que desaparece sem ninguém ter pedido não dá
  // para reler depois. Só um prazo escolhido de propósito liga a autodestruição.
  const config = normalizeConfig({});

  // O alcance padrão é o canal (regras de flood escolhem a DM de propósito, para
  // não somar barulho ao barulho), e nenhuma regra nasce apagando o próprio aviso.
  assert.equal(BASE_DEFAULTS.notify, 'channel');
  assert.equal(BASE_DEFAULTS.noticeTtlMs, 0);

  for (const key of Object.keys(RULES)) {
    assert.ok(['none', 'channel', 'dm'].includes(config.rules[key].notify), `${key} tem alcance inválido`);
    assert.equal(config.rules[key].noticeTtlMs, 0, `${key} não deveria apagar o aviso sozinho`);
  }
});

test('normalizeNoticeTtl trata zero como valor, não como ausência', () => {
  // O bug fácil aqui é o zero cair no piso de 3s e o aviso voltar a se apagar.
  assert.equal(normalizeNoticeTtl(0, 10_000), 0);
  assert.equal(normalizeNoticeTtl('0', 10_000), 0);

  // Fora da faixa: prende no piso e no teto em vez de recusar.
  assert.equal(normalizeNoticeTtl(500, 0), MIN_NOTICE_TTL_MS);
  assert.equal(normalizeNoticeTtl(99_999_999, 0), MAX_NOTICE_TTL_MS);

  // Lixo e negativo caem no default, sem inventar prazo.
  assert.equal(normalizeNoticeTtl('qualquer coisa', 0), 0);
  assert.equal(normalizeNoticeTtl(-1, 0), 0);
  assert.equal(normalizeNoticeTtl(undefined, 5_000), 5_000);
});

test('as opções de prazo do painel cabem no que a config aceita', () => {
  // Guarda contra o painel oferecer um valor que a normalização depois altera —
  // o usuário escolheria "5 minutos" e veria outra coisa salva.
  for (const choice of NOTICE_TTL_CHOICES) {
    assert.equal(normalizeNoticeTtl(choice.ms, -1), choice.ms, `opção ${choice.label} não sobrevive`);
  }
  assert.ok(NOTICE_TTL_CHOICES.length <= 25, 'select do Discord aceita 25 opções');
  assert.equal(NOTICE_TTL_CHOICES[0].ms, 0, 'a primeira opção deve ser a de não apagar');
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

test('detector everyone ignora a permissão do Discord', () => {
  // O caso que fazia o filtro parecer quebrado: cargo @everyone com "Mencionar
  // @everyone" liberada. A permissão não isenta mais ninguém — quem deve poder
  // mencionar entra nas isenções do bot.
  const limits = limitsOf('everyone');
  const withPermission = { permissions: { has: () => true } };
  const without = { permissions: { has: () => false } };

  assert.ok(excess.everyone({ content: 'oi @everyone', member: without }, limits));
  assert.ok(excess.everyone({ content: 'oi @everyone', member: withPermission }, limits));
  assert.ok(excess.everyone({ content: 'oi @here', member: withPermission }, limits));
  assert.equal(excess.everyone({ content: 'oi pessoal', member: without }, limits), null);
});

test('nenhuma regra tem limite de isenção por permissão', () => {
  // Guarda contra a reintrodução do padrão: qualquer campo cujo nome sugira
  // "ignorar quem pode" deve ser uma isenção explícita, não um limite da regra.
  for (const [key, rule] of Object.entries(RULES)) {
    for (const name of Object.keys(rule.fields)) {
      assert.ok(!/^ignore(Allowed|Permitted)$/.test(name), `${key}.${name} deduz isenção de permissão`);
    }
  }
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

test('classifyAttachment usa o contentType e cai na extensão', () => {
  assert.equal(classifyAttachment({ name: 'a.png', contentType: 'image/png' }), 'images');
  assert.equal(classifyAttachment({ name: 'a.gif', contentType: 'image/gif' }), 'gifs');
  assert.equal(classifyAttachment({ name: 'a.mp4', contentType: 'video/mp4' }), 'videos');

  // contentType nulo acontece; o nome resolve.
  assert.equal(classifyAttachment({ name: 'foto.JPEG', contentType: '' }), 'images');
  assert.equal(classifyAttachment({ name: 'meme.gif' }), 'gifs');
  assert.equal(classifyAttachment({ name: 'clipe.webm' }), 'videos');

  // Áudio e desconhecido caem no catch-all, que é o desfecho seguro.
  assert.equal(classifyAttachment({ name: 'audio.mp3', contentType: 'audio/mpeg' }), 'files');
  assert.equal(classifyAttachment({ name: 'sem-extensao' }), 'files');
  assert.equal(classifyAttachment({}), 'files');
});

test('detector media barra anexo, figurinha e link de mídia', () => {
  const all = limitsOf('media');
  const ctx = (over) => ({ content: '', attachmentFiles: [], stickers: 0, ...over });

  assert.match(media.media(ctx({ attachmentFiles: [{ name: 'a.png', contentType: 'image/png' }] }), all).detail, /imagem em anexo \(\.png\)/);
  assert.match(media.media(ctx({ stickers: 1 }), all).detail, /figurinha/);
  assert.match(media.media(ctx({ content: 'olha https://tenor.com/view/abc' }), all).detail, /link de gif: tenor\.com/);
  assert.match(media.media(ctx({ content: 'veja i.imgur.com/x.png' }), all).detail, /link de imagem: i\.imgur\.com/);

  // Texto puro passa, e o nome do arquivo nunca entra no detail.
  assert.equal(media.media(ctx({ content: 'só conversa aqui' }), all), null);
  assert.doesNotMatch(
    media.media(ctx({ attachmentFiles: [{ name: '**grito**.png', contentType: 'image/png' }] }), all).detail,
    /grito/
  );
});

test('detector media respeita a categoria desligada', () => {
  const onlyGifs = limitsOf('media', { images: false, videos: false, files: false, stickers: false });
  const ctx = (over) => ({ content: '', attachmentFiles: [], stickers: 0, ...over });

  assert.equal(media.media(ctx({ attachmentFiles: [{ name: 'a.png', contentType: 'image/png' }] }), onlyGifs), null);
  assert.equal(media.media(ctx({ stickers: 3 }), onlyGifs), null);
  assert.ok(media.media(ctx({ attachmentFiles: [{ name: 'a.gif', contentType: 'image/gif' }] }), onlyGifs));

  // Link comum não vira violação de mídia: isso é da regra "Links em geral".
  assert.equal(findMediaLink('entra em exemplo.com/pagina', limitsOf('media')), null);
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

test('extractDomains exige TLD conhecido só sem esquema', () => {
  assert.deepEqual(extractDomains('vai em exemplo.com agora'), ['exemplo.com']);
  assert.deepEqual(extractDomains('olha loja.com.br'), ['loja.com.br']);
  assert.deepEqual(extractDomains('www.exemplo.com'), ['exemplo.com']);
  // Nomes de arquivo e versões não são links.
  assert.deepEqual(extractDomains('abre o index.js da versão 1.2'), []);

  // Com esquema, qualquer TLD conta: quem escreve https:// está mandando link.
  assert.deepEqual(extractDomains('entra em https://premio.zyx'), ['premio.zyx']);
  assert.deepEqual(extractDomains('hxxps://phish.qwerty/login'), ['phish.qwerty']);
  assert.deepEqual(extractDomains('roda http://localhost:3000'), [], 'host sem ponto não é domínio');
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

const LADDER = [
  { points: 3, action: 'mute', muteMs: 600_000 },
  { points: 5, action: 'mute', muteMs: 3_600_000 },
  { points: 8, action: 'kick' },
];

test('ladderStep devolve o degrau alcançado, para exibição', () => {
  assert.equal(ladderStep(LADDER, 2), null);
  assert.equal(ladderStep(LADDER, 3).action, 'mute');
  assert.equal(ladderStep(LADDER, 8).action, 'kick');
  assert.equal(ladderStep(LADDER, 100).points, 8, 'acima do topo continua no topo');
  assert.equal(ladderStep(LADDER, 7).points, 5, 'entre dois limiares fica no de baixo');
  assert.equal(ladderStep([], 10), null);
  assert.equal(ladderStep(undefined, 10), null);
});

test('crossedStep só acusa degrau quando a pontuação passa por um limiar', () => {
  assert.equal(crossedStep(LADDER, 6, 7), null, '6 → 7 não cruza nada: o degrau de 5 já foi pago');
  assert.equal(crossedStep(LADDER, 2, 3).points, 3);
  assert.equal(crossedStep(LADDER, 2, 7).points, 5, 'dois limiares de uma vez: vale o mais alto');
  assert.equal(crossedStep(LADDER, 0, 100).points, 8);
  assert.equal(crossedStep(LADDER, 5, 5), null, 'sem avanço, sem degrau');
  assert.equal(crossedStep(LADDER, 9, 4), null, 'pontuação que caiu não cruza para trás');
  assert.equal(crossedStep([], 0, 10), null);
  assert.equal(crossedStep(undefined, 0, 10), null);
});

test('pickAction aplica uma punição por evento: a mais grave', () => {
  const rule = (action, muteMs) => ({ action, muteMs });

  assert.equal(pickAction(rule('warn'), { points: 5, action: 'mute' }).action, 'mute', 'escada mais grave vence');
  assert.equal(pickAction(rule('ban'), { points: 5, action: 'kick' }).action, 'ban', 'regra mais grave vence');
  assert.equal(pickAction(rule('kick'), null).action, 'kick', 'sem degrau, vale a regra');
  assert.equal(pickAction(rule('none'), { points: 5, action: 'warn' }).action, 'warn');
  assert.equal(pickAction(rule('mute', 600_000), { points: 5, action: 'none' }).action, 'mute');

  // Empate em mute: o timeout mais longo, para o degrau não encurtar a punição.
  assert.equal(pickAction(rule('mute', 600_000), { points: 5, action: 'mute', muteMs: 3_600_000 }).muteMs, 3_600_000);
  assert.equal(pickAction(rule('mute', 86_400_000), { points: 5, action: 'mute', muteMs: 600_000 }).muteMs, 86_400_000);
});

test('noticeText não afirma remoção quando nada foi removido', () => {
  const violation = { label: 'Palavras proibidas' };
  const muted = [{ ok: true, detail: 'silenciado por 10 minutos' }];

  assert.match(noticeText(violation, [], true), /removida/);
  assert.doesNotMatch(noticeText(violation, [], false), /removida/);
  assert.match(noticeText(violation, [], false), /infringe as regras/);
  assert.match(noticeText(violation, muted, false), /Você foi silenciado por 10 minutos\./);

  // Falha na punição não vira promessa de punição no aviso ao infrator.
  assert.doesNotMatch(noticeText(violation, [{ ok: false, detail: 'sem hierarquia' }], true), /Você foi/);
});

test('canNotify separa canal de DM, mas trava os dois', () => {
  const g = 'guild-cooldown';
  const u = 'user-cooldown';
  const now = Date.now();

  assert.equal(canNotify(g, u, 'canal-1', now), true);
  assert.equal(canNotify(g, u, 'canal-1', now + 1), false, 'segundo aviso na mesma janela não passa');
  assert.equal(canNotify(g, u, 'canal-2', now + 1), true, 'outro canal, outra plateia');

  // A DM tem escopo próprio: um flood espalhado por canais não rende uma DM por canal.
  assert.equal(canNotify(g, u, 'dm', now + 2), true);
  assert.equal(canNotify(g, u, 'dm', now + 3), false, 'a DM também respeita o cooldown');
  assert.equal(canNotify(g, u, 'dm', now + 3 + NOTICE_COOLDOWN_MS), true, 'passada a janela, libera');
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

/** Membro falso só com o cache de canais que o `parentOf` consulta. */
const memberWithChannels = (entries) => ({ guild: { channels: { cache: new Map(entries) } } });

test('watchesChannel restringe só as regras de lista de canais', () => {
  const member = memberWithChannels([['topico', { parentId: 'geral' }]]);

  // Regra comum: vale em qualquer canal, a lista nem é consultada.
  assert.equal(watchesChannel('links', { watchChannelIds: [] }, member, 'geral'), true);

  // Regra de lista: vazia é "nenhum canal", não "todos".
  assert.equal(watchesChannel('media', { watchChannelIds: [] }, member, 'geral'), false);
  assert.equal(watchesChannel('media', { watchChannelIds: ['geral'] }, member, 'geral'), true);
  assert.equal(watchesChannel('media', { watchChannelIds: ['geral'] }, member, 'memes'), false);

  // Vigiar o canal-pai vigia o tópico dele.
  assert.equal(watchesChannel('media', { watchChannelIds: ['geral'] }, member, 'topico'), true);
  assert.equal(watchesChannel('media', { watchChannelIds: ['outro'] }, member, 'topico'), false);
});

test('findViolation não consulta a regra de mídia fora dos canais vigiados', async () => {
  const { findViolation } = require('../utils/automod/detectors');
  const SO_TEXTO = '100000000000000001';
  const MEMES = '100000000000000002';

  const config = normalizeConfig({
    enabled: true,
    ladder: [],
    // Ids de verdade: `normalizeConfig` descarta o que não é snowflake.
    rules: { media: { enabled: true, watchChannelIds: [SO_TEXTO] } },
  });

  const ctx = (channelId) => ({
    content: 'olha isto https://i.imgur.com/foto.png',
    signature: 'olha isto',
    member: memberWithChannels([]),
    guild: null,
    channelId,
    attachmentFiles: [],
    attachmentNames: [],
    attachments: 0,
    stickers: 0,
    now: Date.now(),
  });

  const inside = await findViolation(ctx(SO_TEXTO), config);
  assert.equal(inside?.key, 'media', 'no canal vigiado a regra pega o link de mídia');

  assert.equal(await findViolation(ctx(MEMES), config), null, 'fora dele nem é avaliada');
});

test('idleReason aponta a regra ligada que não vai agir', () => {
  const media = (extra) => ({ ...ruleDefaults('media'), enabled: true, ...extra });

  assert.equal(idleReason('media', media({})), 'nenhum canal vigiado');
  assert.equal(
    idleReason('media', media({ watchChannelIds: ['c'], limits: { images: false, gifs: false, videos: false, files: false, stickers: false } })),
    'nenhuma categoria marcada'
  );
  assert.equal(
    idleReason('media', media({ watchChannelIds: ['c'], deleteMessage: false, action: 'none', points: 0 })),
    'não apaga, não pune e não dá pontos'
  );
  assert.equal(idleReason('media', media({ watchChannelIds: ['c'] })), null, 'configurada: age');
  assert.equal(idleReason('media', { ...ruleDefaults('media'), enabled: false }), null, 'desligada não é aviso');
});

test('a trava por id impede punir a mesma mensagem duas vezes', () => {
  const id = '900000000000000001';
  const t0 = 1_000_000;

  assert.equal(wasHandled(id, t0), false, 'mensagem nova ainda não foi punida');

  markHandled(id, t0);
  // É este caso que o bug produzia: o `messageUpdate` do anexo chegando segundos
  // depois do `messageCreate` que já apagou e puniu.
  assert.equal(wasHandled(id, t0 + 2000), true);

  // Passado o prazo a entrada é descartada, senão o Map cresceria para sempre.
  assert.equal(wasHandled(id, t0 + HANDLED_TTL_MS + 1), false);
  assert.equal(wasHandled(id, t0 + 2000), false, 'entrada expirada não volta');
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

/**
 * O reincidente com muito histórico: a soma antiga carregava as linhas para somar
 * em JS e parava nas 200 primeiras, então a pontuação de quem passava disso
 * **caía** em vez de subir. 250 linhas de 1 ponto têm de dar 250.
 */
test('activePoints soma sem teto de linhas', async (t) => {
  const { recordInfraction, activePoints, clearInfractions } = require('../utils/automod/infractions');

  const guildId = 'test-automod-bulk';
  const userId = 'test-user-bulk';

  clearInfractions(guildId, userId);
  t.after(() => clearInfractions(guildId, userId));

  for (let i = 0; i < 250; i += 1) {
    recordInfraction({ guildId, userId, ruleKey: 'caps', points: 1, reason: 'teste' });
  }

  assert.equal(activePoints(guildId, userId, 168), 250);
  assert.equal(activePoints(guildId, userId, 0), 250);
});
