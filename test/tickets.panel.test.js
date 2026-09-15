/**
 * Testes do painel público de tickets.
 *
 * O que importa aqui é que `buildTicketPanel` sempre produza uma mensagem que o
 * Discord aceita: título e rótulo de botão nunca vazios, cor inválida não vira
 * erro de API e emoji personalizado que saiu do ar não derruba o envio — se
 * qualquer um desses passar, o painel simplesmente não aparece no canal.
 *
 * `guild` pode ser `null` porque `emoji(null, key)` cai nos emojis padrão.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTicketConfig, DEFAULTS } = require('../utils/tickets/config');
const {
  DEFAULT_TITLE_TEXT,
  DEFAULT_DESCRIPTION,
  resolveButtonEmoji,
  buildTicketPanel,
} = require('../utils/tickets/panel');

/** Guild fake: só o cache de emojis é consultado pelo painel. */
const fakeGuild = (emojiIds = []) => ({
  id: '400000000000000001',
  emojis: { cache: new Map(emojiIds.map((id) => [id, { id }])) },
});

const panelOf = (raw, guild = null) => buildTicketPanel(guild, normalizeTicketConfig(raw));

test('config vazia gera painel com textos e botão padrão', () => {
  const { embeds, components } = panelOf({});
  const embed = embeds[0].data;
  const button = components[0].components[0].data;

  assert.ok(embed.title.includes(DEFAULT_TITLE_TEXT));
  assert.equal(embed.description, DEFAULT_DESCRIPTION);
  assert.equal(button.custom_id, 'ticket_open');
  assert.equal(button.label, DEFAULTS.panelButtonLabel);
});

test('textos e cor configurados aparecem no embed', () => {
  const { embeds } = panelOf({
    panel: { title: 'Suporte 24h', description: 'Fale com a gente', color: '#5865F2' },
  });
  const embed = embeds[0].data;

  assert.equal(embed.title, 'Suporte 24h');
  assert.equal(embed.description, 'Fale com a gente');
  assert.equal(embed.color, 0x5865f2);
});

test('cor inválida cai na cor padrão em vez de virar erro de API', () => {
  const { embeds } = panelOf({ panel: { color: 'roxo-inexistente' } });
  assert.equal(typeof embeds[0].data.color, 'number');
});

test('painel nunca menciona ninguém', () => {
  assert.deepEqual(panelOf({ panel: { description: '<@&100000000000000001> venha' } }).allowedMentions, {
    parse: [],
  });
});

test('emoji personalizado que saiu do servidor volta ao padrão', () => {
  const config = normalizeTicketConfig({ panel: { buttonEmoji: '<:sumiu:900000000000000001>' } });

  // No servidor que ainda tem o emoji, ele é usado como está.
  const presente = fakeGuild(['900000000000000001']);
  assert.equal(resolveButtonEmoji(presente, config), '<:sumiu:900000000000000001>');

  // Sem o emoji no cache, cai no padrão — id inválido recusa a mensagem inteira.
  const ausente = fakeGuild([]);
  assert.notEqual(resolveButtonEmoji(ausente, config), '<:sumiu:900000000000000001>');
});

test('imagem entra no embed e link inválido é descartado na normalização', () => {
  const comGif = panelOf({ panel: { imageUrl: 'https://exemplo.com/banner.gif' } });
  assert.equal(comGif.embeds[0].data.image.url, 'https://exemplo.com/banner.gif');

  // Sem http(s) o embed recusaria a mensagem inteira, então nem chega ao painel.
  const invalida = panelOf({ panel: { imageUrl: 'banner.gif' } });
  assert.equal(invalida.embeds[0].data.image, undefined);
});

test('emoji unicode configurado é mantido', () => {
  const config = normalizeTicketConfig({ panel: { buttonEmoji: '🎟️' } });
  assert.equal(resolveButtonEmoji(fakeGuild(), config), '🎟️');
});
