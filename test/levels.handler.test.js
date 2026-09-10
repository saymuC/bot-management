/**
 * Testes de integração do handler de mensagens.
 *
 * Aqui está o que nenhum teste de unidade pega: a **ordem** das decisões. Um
 * canal ignorado, um cargo isento ou o sistema desligado não podem só deixar de
 * anunciar — eles não podem criar registro nenhum, senão o `/top` enche de gente
 * que nunca deveria ter pontuado.
 *
 * A mensagem é um objeto de mentira com só os campos que o handler lê, no mesmo
 * espírito dos testes do AutoMod. Toca o banco sob um `guild_id` reservado.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');

const { db } = require('../database/db');
const repository = require('../utils/levels/repository');
const tracker = require('../utils/levels/tracker');
const { saveLevelsConfig } = require('../utils/levels/config');
const { handleMessageForLevels, isIgnorable, resolveAnnounceChannel } = require('../handlers/levelsHandler');

const GUILD = 'test-levels-handler';
const OTHER_GUILD = 'test-levels-handler-2';
const USER = 'test-handler-user';
const CHANNEL = '900000000000000001';
const OTHER_CHANNEL = '900000000000000002';
const ROLE = '900000000000000010';

// Ao contrário dos outros testes, este grava config, então a limpeza tem de tirar
// a linha de `guild_config` também — senão o banco de desenvolvimento acumula
// servidores de teste que aparecem em qualquer varredura futura.
const deleteConfig = db.prepare('DELETE FROM guild_config WHERE guild_id = ?');

/** Estado limpo: banco, config e cooldown dos servidores de teste. */
function reset() {
  for (const guildId of [GUILD, OTHER_GUILD]) {
    repository.deleteGuild(guildId);
    deleteConfig.run(guildId);
    tracker.clearGuild(guildId);
  }
}

/**
 * Mensagem de mentira.
 * @param {object} [overrides]
 */
function fakeMessage(overrides = {}) {
  const sent = [];
  const channel = {
    id: overrides.channelId ?? CHANNEL,
    parentId: null,
    isTextBased: () => true,
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
  };

  const guild = {
    id: GUILD,
    name: 'Servidor de Teste',
    channels: { cache: new Collection([[channel.id, channel]]) },
    members: { me: { roles: { highest: { position: 100 } }, permissions: { has: () => true } } },
    roles: { cache: new Collection() },
  };

  return {
    sent,
    guild,
    channel,
    content: overrides.content ?? 'uma mensagem perfeitamente normal',
    author: { id: overrides.userId ?? USER, bot: false, toString: () => `<@${overrides.userId ?? USER}>` },
    webhookId: null,
    system: false,
    member: {
      guild,
      roles: {
        cache: new Collection((overrides.roleIds ?? []).map((id) => [id, { id }])),
        add: async () => {},
        remove: async () => {},
      },
    },
    ...overrides.extra,
  };
}

const ENABLED = {
  enabled: true,
  xpMin: 20,
  xpMax: 20,
  cooldownSeconds: 60,
  minUsefulChars: 5,
  repeatWindowSeconds: 300,
  announceEnabled: true,
};

test.before(reset);
test.after(reset);

test('isIgnorable barra DM, bot, webhook e mensagem de sistema', () => {
  assert.equal(isIgnorable(null), true);
  assert.equal(isIgnorable({ guild: null, author: { bot: false } }), true, 'DM');
  assert.equal(isIgnorable({ guild: {}, author: { bot: true } }), true, 'bot');
  assert.equal(isIgnorable({ guild: {}, author: { bot: false }, webhookId: '123' }), true, 'webhook');
  assert.equal(isIgnorable({ guild: {}, author: { bot: false }, system: true }), true, 'sistema');
  assert.equal(isIgnorable({ guild: {}, author: { bot: false } }), false);
});

test('com o sistema desligado nenhum registro é criado', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, enabled: false });

  assert.equal(await handleMessageForLevels(fakeMessage()), null);
  assert.equal(repository.participantCount(GUILD), 0, 'ninguém entrou no ranking');
});

test('uma mensagem normal concede o XP sorteado', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, ENABLED);

  const change = await handleMessageForLevels(fakeMessage());

  assert.equal(change.delta, 20);
  assert.equal(repository.getXp(GUILD, USER), 20);
});

test('o cooldown é marcado só depois de a gravação dar certo', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, ENABLED);

  assert.equal(tracker.isOnCooldown(GUILD, USER), false);
  await handleMessageForLevels(fakeMessage());
  assert.equal(tracker.isOnCooldown(GUILD, USER), true);
});

test('a segunda mensagem dentro do cooldown não concede XP', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, ENABLED);

  await handleMessageForLevels(fakeMessage({ content: 'primeira frase da conversa' }));
  const second = await handleMessageForLevels(fakeMessage({ content: 'segunda frase, bem diferente' }));

  assert.equal(second, null);
  assert.equal(repository.getXp(GUILD, USER), 20, 'o total não mudou');
});

test('repetir a mesma frase não concede XP nem gasta o cooldown', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, cooldownSeconds: 10 });

  await handleMessageForLevels(fakeMessage({ content: 'bom dia pessoal' }));
  tracker.clearUser(GUILD, USER); // simula o cooldown já vencido
  tracker.rememberSignature(GUILD, USER, require('../utils/levels/antiFarm').contentSignature('bom dia pessoal'));

  const repeat = await handleMessageForLevels(fakeMessage({ content: 'BOM DIA PESSOAL' }));
  assert.equal(repeat, null, 'caixa diferente é a mesma mensagem');
});

test('canal ignorado não gera registro', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, ignoredChannelIds: [CHANNEL] });

  assert.equal(await handleMessageForLevels(fakeMessage()), null);
  assert.equal(repository.participantCount(GUILD), 0);
});

test('cargo isento não gera registro', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, ignoredRoleIds: [ROLE] });

  assert.equal(await handleMessageForLevels(fakeMessage({ roleIds: [ROLE] })), null);
  assert.equal(repository.participantCount(GUILD), 0);
});

test('mensagem curta, comando e emoji solto não geram registro', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, ENABLED);

  for (const content of ['ok', '!play musica', '😀', 'https://exemplo.com']) {
    assert.equal(await handleMessageForLevels(fakeMessage({ content })), null, content);
  }
  assert.equal(repository.participantCount(GUILD), 0);
});

test('o level-up é anunciado uma vez, com menção restrita ao autor', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, xpMin: 100, xpMax: 100 });

  const message = fakeMessage();
  const change = await handleMessageForLevels(message);

  assert.equal(change.direction, 'up');
  assert.equal(message.sent.length, 1, 'uma única mensagem');
  assert.deepEqual(message.sent[0].allowedMentions, { users: [USER] });
  assert.match(message.sent[0].content, /nível \*\*1\*\*/);
});

test('salto de vários níveis rende um único anúncio com as duas pontas', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, xpMin: 5000, xpMax: 5000 });

  const message = fakeMessage();
  const change = await handleMessageForLevels(message);

  assert.ok(change.newLevel > change.previousLevel + 1, 'pulou mais de um nível');
  assert.equal(message.sent.length, 1);
  assert.match(message.sent[0].content, /avançou do nível/);
});

test('sem level-up não há anúncio', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, ENABLED);

  const message = fakeMessage();
  await handleMessageForLevels(message);
  assert.equal(message.sent.length, 0);
});

test('anúncio desligado não impede o XP', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, xpMin: 100, xpMax: 100, announceEnabled: false });

  const message = fakeMessage();
  const change = await handleMessageForLevels(message);

  assert.equal(change.newLevel, 1);
  assert.equal(repository.getXp(GUILD, USER), 100);
  assert.equal(message.sent.length, 0);
});

test('uma falha no anúncio não desfaz o XP já gravado', async (t) => {
  t.after(reset);
  saveLevelsConfig(GUILD, { ...ENABLED, xpMin: 100, xpMax: 100 });

  const message = fakeMessage();
  message.channel.send = async () => {
    throw new Error('Missing Permissions');
  };

  const change = await handleMessageForLevels(message);

  assert.equal(change.newLevel, 1, 'a alteração foi reportada normalmente');
  assert.equal(repository.getXp(GUILD, USER), 100, 'o XP continua gravado');
});

test('canal de anúncio apagado cai no canal da mensagem', () => {
  const message = fakeMessage();
  const resolved = resolveAnnounceChannel(message, { announceChannelId: '999999999999999999' });
  assert.equal(resolved, message.channel);
});

test('sem canal configurado o anúncio sai onde o membro está', () => {
  const message = fakeMessage();
  assert.equal(resolveAnnounceChannel(message, { announceChannelId: null }), message.channel);
});

test('o canal configurado é usado quando existe e é enviável', () => {
  const message = fakeMessage();
  const target = { id: OTHER_CHANNEL, isTextBased: () => true, permissionsFor: () => ({ has: () => true }) };
  message.guild.channels.cache.set(OTHER_CHANNEL, target);

  assert.equal(resolveAnnounceChannel(message, { announceChannelId: OTHER_CHANNEL }), target);
});

test('canal configurado sem permissão cai no canal da mensagem', () => {
  const message = fakeMessage();
  const target = { id: OTHER_CHANNEL, isTextBased: () => true, permissionsFor: () => ({ has: () => false }) };
  message.guild.channels.cache.set(OTHER_CHANNEL, target);

  assert.equal(resolveAnnounceChannel(message, { announceChannelId: OTHER_CHANNEL }), message.channel);
});

test('dois servidores têm cooldowns independentes', async (t) => {
  t.after(reset);

  saveLevelsConfig(GUILD, ENABLED);
  saveLevelsConfig(OTHER_GUILD, ENABLED);

  await handleMessageForLevels(fakeMessage());

  const other = fakeMessage();
  other.guild.id = OTHER_GUILD;
  const change = await handleMessageForLevels(other);

  assert.equal(change?.delta, 20, 'o cooldown de um servidor não trava o outro');
});
