/**
 * Testes do anti-farm e do tracker de cooldown/repetição.
 *
 * Os dois lados do filtro têm custos assimétricos: deixar passar farm óbvio só
 * suja o ranking, mas barrar conversa normal tira XP de quem está usando o
 * servidor como deveria. Os casos abaixo cobrem os dois, e em especial a frase
 * legítima **com** link ou emoji — que um filtro ingênuo rejeitaria.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { usefulContent, usefulLength, contentSignature, looksLikeCommand, inspectContent, rollXp } =
  require('../utils/levels/antiFarm');
const tracker = require('../utils/levels/tracker');

const CONFIG = { minUsefulChars: 5 };

// ---------------------------------------------------------------------------
// Conteúdo útil
// ---------------------------------------------------------------------------

test('menções, links e emojis não contam como esforço do autor', () => {
  assert.equal(usefulContent('<@123456789012345678>'), '');
  assert.equal(usefulContent('<@!123456789012345678> <#123456789012345678>'), '');
  assert.equal(usefulContent('https://exemplo.com/uma/url/enorme'), '');
  assert.equal(usefulContent('😀😀😀'), '');
  assert.equal(usefulContent('<:pepe:123456789012345678>'), '');
  assert.equal(usefulContent('<a:dance:123456789012345678>'), '');
});

test('emoji personalizado é removido sem deixar o id numérico atrás', () => {
  // A regex de menção também casa `<...>`: se ela rodasse antes, comeria o
  // `<:nome:` e deixaria dígitos que contariam como texto.
  assert.equal(usefulContent('<:pepe:123456789012345678>'), '');
  assert.ok(!/\d/.test(usefulContent('oi <:pepe:123456789012345678>')));
});

test('uma frase de verdade com link ou emoji continua valendo', () => {
  const withLink = 'olha esse artigo sobre a atualização https://exemplo.com/post';
  const withEmoji = 'bom dia pessoal, tudo certo por aqui 😀';

  assert.ok(usefulLength(withLink) >= CONFIG.minUsefulChars);
  assert.equal(inspectContent(withLink, CONFIG).eligible, true);
  assert.equal(inspectContent(withEmoji, CONFIG).eligible, true);
});

test('texto curto não concede XP', () => {
  for (const content of ['ok', '.', 'a', 'kk']) {
    const result = inspectContent(content, CONFIG);
    assert.equal(result.eligible, false, content);
    assert.equal(result.reason, 'texto curto');
  }
});

test('mensagem sem conteúdo útil é rejeitada com a razão certa', () => {
  for (const content of ['', '   ', '😀', '<@123456789012345678>', 'https://exemplo.com']) {
    const result = inspectContent(content, CONFIG);
    assert.equal(result.eligible, false, content);
    assert.equal(result.reason, 'sem conteúdo útil');
  }
});

test('comando de bot não concede XP', () => {
  assert.equal(looksLikeCommand('!play musica'), true);
  assert.equal(looksLikeCommand('/rank'), true);
  assert.equal(looksLikeCommand('.help'), true);
  assert.equal(looksLikeCommand('?comando'), true);
  assert.equal(inspectContent('!play uma musica bem longa', CONFIG).reason, 'comando');
});

test('pontuação no meio da frase não faz dela um comando', () => {
  assert.equal(looksLikeCommand('e ai, tudo bem?'), false);
  assert.equal(looksLikeCommand('...não sei'), false, 'reticências seguidas de letra acentuada');
  assert.equal(inspectContent('e ai pessoal, tudo bem?', CONFIG).eligible, true);
});

test('a assinatura ignora caixa e acento', () => {
  assert.equal(contentSignature('Bom Dia'), contentSignature('bom dia'));
  assert.equal(contentSignature('atenção'), contentSignature('atencao'));
  assert.equal(contentSignature('oi    pessoal'), contentSignature('oi pessoal'));
});

test('rollXp sorteia inclusivamente entre mínimo e máximo', () => {
  assert.equal(rollXp({ xpMin: 15, xpMax: 25 }, () => 0), 15);
  assert.equal(rollXp({ xpMin: 15, xpMax: 25 }, () => 0.999999), 25);
  assert.equal(rollXp({ xpMin: 20, xpMax: 20 }, () => 0.5), 20);
  // Config invertida não pode render NaN nem valor negativo no motor.
  assert.equal(rollXp({ xpMin: 30, xpMax: 10 }, () => 0), 30);
});

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

const GUILD = 'test-levels-tracker';
const OTHER_GUILD = 'test-levels-tracker-2';
const USER = 'test-user-1';

test('cooldown vale por usuário e por servidor', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  tracker.markCooldown(GUILD, USER, 60, now);

  assert.equal(tracker.isOnCooldown(GUILD, USER, now + 1000), true);
  assert.equal(tracker.isOnCooldown(GUILD, 'outro-usuario', now + 1000), false, 'outro usuário');
  assert.equal(tracker.isOnCooldown(OTHER_GUILD, USER, now + 1000), false, 'mesmo usuário, outro servidor');
});

test('o cooldown vence no tempo configurado', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  tracker.markCooldown(GUILD, USER, 60, now);

  assert.equal(tracker.isOnCooldown(GUILD, USER, now + 59_999), true);
  assert.equal(tracker.isOnCooldown(GUILD, USER, now + 60_000), false, 'exatamente no fim já liberou');
  assert.equal(tracker.cooldownRemaining(GUILD, USER, now + 30_000), 30_000);
});

test('repetição é detectada dentro da janela e liberada depois', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  const signature = contentSignature('bom dia pessoal');
  tracker.rememberSignature(GUILD, USER, signature, now);

  assert.equal(tracker.isRepeat(GUILD, USER, signature, 300, now + 1000), true);
  assert.equal(tracker.isRepeat(GUILD, USER, signature, 300, now + 301_000), false, 'fora da janela');
  assert.equal(tracker.isRepeat(GUILD, USER, contentSignature('outra frase'), 300, now + 1000), false);
});

test('a repetição pega variação de caixa e acento', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  tracker.rememberSignature(GUILD, USER, contentSignature('Atenção Pessoal'), now);
  assert.equal(tracker.isRepeat(GUILD, USER, contentSignature('atencao pessoal'), 300, now + 1), true);
});

test('janela 0 desliga a trava de repetição', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  const signature = contentSignature('mesma coisa sempre');
  tracker.rememberSignature(GUILD, USER, signature, now);
  assert.equal(tracker.isRepeat(GUILD, USER, signature, 0, now + 1), false);
});

test('a varredura remove cooldowns vencidos e assinaturas velhas', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  tracker.markCooldown(GUILD, USER, 60, now);
  tracker.rememberSignature(GUILD, USER, 'assinatura', now);
  assert.deepEqual(tracker.sizes(), { cooldowns: 1, signatures: 1 });

  tracker.sweep(now + 61_000);
  assert.equal(tracker.sizes().cooldowns, 0, 'cooldown vencido saiu');
  assert.equal(tracker.sizes().signatures, 1, 'assinatura ainda está na retenção de 1h');

  tracker.sweep(now + 3_601_000);
  assert.deepEqual(tracker.sizes(), { cooldowns: 0, signatures: 0 });
});

test('o teto do Map é real, não só uma intenção da varredura', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = Date.now();
  const overflow = tracker.MAX_TRACKED_USERS + 500;
  for (let i = 0; i < overflow; i += 1) tracker.markCooldown(GUILD, `flood-${i}`, 600, now);

  assert.equal(tracker.sizes().cooldowns, tracker.MAX_TRACKED_USERS);
  // O corte é pela ordem de inserção: os mais recentes sobrevivem.
  assert.equal(tracker.isOnCooldown(GUILD, `flood-${overflow - 1}`, now), true);
  assert.equal(tracker.isOnCooldown(GUILD, 'flood-0', now), false);
});

test('cada usuário guarda poucas assinaturas', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = Date.now();
  for (let i = 0; i < tracker.MAX_SIGNATURES_PER_USER + 5; i += 1) {
    tracker.rememberSignature(GUILD, USER, `frase numero ${i}`, now);
  }

  // A mais nova continua detectável; a mais antiga já saiu.
  assert.equal(tracker.isRepeat(GUILD, USER, `frase numero ${tracker.MAX_SIGNATURES_PER_USER + 4}`, 300, now), true);
  assert.equal(tracker.isRepeat(GUILD, USER, 'frase numero 0', 300, now), false);
});

test('repetir a mesma assinatura renova a data em vez de duplicar', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = 1_000_000;
  tracker.rememberSignature(GUILD, USER, 'oi pessoal', now);
  tracker.rememberSignature(GUILD, USER, 'oi pessoal', now + 100_000);

  assert.equal(tracker.isRepeat(GUILD, USER, 'oi pessoal', 300, now + 350_000), true, 'a data nova é a que vale');
});

test('clearUser e clearGuild esquecem o que devem', (t) => {
  tracker.resetTracker();
  t.after(() => tracker.resetTracker());

  const now = Date.now();
  tracker.markCooldown(GUILD, USER, 600, now);
  tracker.markCooldown(GUILD, 'outro', 600, now);
  tracker.markCooldown(OTHER_GUILD, USER, 600, now);

  tracker.clearUser(GUILD, USER);
  assert.equal(tracker.isOnCooldown(GUILD, USER, now), false);
  assert.equal(tracker.isOnCooldown(GUILD, 'outro', now), true);

  tracker.clearGuild(GUILD);
  assert.equal(tracker.isOnCooldown(GUILD, 'outro', now), false);
  assert.equal(tracker.isOnCooldown(OTHER_GUILD, USER, now), true, 'o outro servidor não foi tocado');
});
