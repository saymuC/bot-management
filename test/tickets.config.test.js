/**
 * Testes do normalizador da config de tickets.
 *
 * O contrato que importa: `normalizeTicketConfig` **nunca lança**. Ela é a porta
 * entre um JSON numa coluna de texto (que pode vir de uma versão antiga do bot,
 * das colunas soltas de `guild_config` ou de uma edição à mão) e o runtime que
 * abre e fecha canais. Lançar aqui significaria um servidor onde o painel não
 * abre para consertar a config.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const settings = require('../config/settings');
const {
  DEFAULTS,
  LIMITS,
  normalizeTicketConfig,
  legacyTicketConfig,
} = require('../utils/tickets/config');

const CHANNEL = '200000000000000001';
const CATEGORY = '200000000000000009';
const MESSAGE = '300000000000000001';
const ROLE_A = '100000000000000001';
const ROLE_B = '100000000000000002';

test('entrada vazia devolve os defaults', () => {
  const config = normalizeTicketConfig({});

  assert.equal(config.enabled, true);
  assert.equal(config.maxOpenPerUser, settings.ticket.maxOpenPerUser);
  assert.equal(config.logChannelId, null);
  assert.equal(config.defaultParentCategoryId, null);
  assert.equal(config.panel.channelId, null);
  assert.equal(config.panel.buttonLabel, DEFAULTS.panelButtonLabel);
  assert.deepEqual(config.permissions.staffRoleIds, []);
  assert.equal(config.permissions.allowUserSoftClose, true);
  assert.equal(config.behavior.allowReopen, true);
  assert.equal(config.behavior.createTranscript, true);
  assert.equal(config.behavior.sendRatingDm, true);
  assert.equal(config.behavior.deleteDelaySeconds, DEFAULTS.deleteDelaySeconds);
});

test('entrada não-objeto não lança e cai nos defaults', () => {
  for (const raw of [null, undefined, 'texto', 42, [], true]) {
    assert.deepEqual(normalizeTicketConfig(raw), normalizeTicketConfig({}));
  }
});

test('seções inválidas não contaminam o resto da config', () => {
  const config = normalizeTicketConfig({
    enabled: false,
    panel: 'não é objeto',
    permissions: 7,
    behavior: null,
  });

  assert.equal(config.enabled, false);
  assert.equal(config.panel.buttonLabel, DEFAULTS.panelButtonLabel);
  assert.deepEqual(config.permissions.managerRoleIds, []);
  assert.equal(config.behavior.allowReopen, true);
});

test('ids inválidos viram null e cargos ruins são descartados', () => {
  const config = normalizeTicketConfig({
    logChannelId: 'abc',
    defaultParentCategoryId: '123',
    panel: { channelId: CHANNEL, messageId: 'nope' },
    permissions: { staffRoleIds: [ROLE_A, 'x', ROLE_A, ROLE_B, null], managerRoleIds: 'nada' },
  });

  assert.equal(config.logChannelId, null);
  assert.equal(config.defaultParentCategoryId, null);
  assert.equal(config.panel.channelId, CHANNEL);
  assert.equal(config.panel.messageId, null);
  assert.deepEqual(config.permissions.staffRoleIds, [ROLE_A, ROLE_B]);
  assert.deepEqual(config.permissions.managerRoleIds, []);
});

test('messageId sem canal é descartado — republicar precisa dos dois', () => {
  const config = normalizeTicketConfig({ panel: { messageId: MESSAGE } });
  assert.equal(config.panel.messageId, null);
});

test('cargos respeitam o teto do role select do Discord', () => {
  const many = Array.from({ length: 40 }, (_, i) => String(100000000000000000n + BigInt(i)));
  const config = normalizeTicketConfig({ permissions: { staffRoleIds: many } });
  assert.equal(config.permissions.staffRoleIds.length, LIMITS.roleIds);
});

test('números fora da faixa grudam nos limites', () => {
  const baixo = normalizeTicketConfig({
    maxOpenPerUser: 0,
    behavior: { deleteDelaySeconds: -10 },
  });
  assert.equal(baixo.maxOpenPerUser, LIMITS.maxOpenPerUser.min);
  assert.equal(baixo.behavior.deleteDelaySeconds, LIMITS.deleteDelaySeconds.min);

  const alto = normalizeTicketConfig({
    maxOpenPerUser: 999,
    behavior: { deleteDelaySeconds: 9999 },
  });
  assert.equal(alto.maxOpenPerUser, LIMITS.maxOpenPerUser.max);
  assert.equal(alto.behavior.deleteDelaySeconds, LIMITS.deleteDelaySeconds.max);

  // Texto do modal continua valendo enquanto for número.
  assert.equal(normalizeTicketConfig({ maxOpenPerUser: '4' }).maxOpenPerUser, 4);
  assert.equal(
    normalizeTicketConfig({ maxOpenPerUser: 'muitos' }).maxOpenPerUser,
    DEFAULTS.maxOpenPerUser
  );
});

test('booleanos aceitam as formas que os modais produzem', () => {
  const config = normalizeTicketConfig({
    enabled: 'nao',
    permissions: { allowUserSoftClose: 'não' },
    behavior: { createTranscript: 'sim', sendRatingDm: 0, allowReopen: 'lixo' },
  });

  assert.equal(config.enabled, false);
  assert.equal(config.permissions.allowUserSoftClose, false);
  assert.equal(config.behavior.createTranscript, true);
  assert.equal(config.behavior.sendRatingDm, false);
  // Valor irreconhecível cai no default, não em `false`.
  assert.equal(config.behavior.allowReopen, true);
});

test('textos do painel são cortados e vazio volta ao default', () => {
  const config = normalizeTicketConfig({
    panel: { title: `  ${'t'.repeat(400)}  `, buttonLabel: '   ', description: ' Abra aqui ' },
  });

  assert.equal(config.panel.title.length, 256);
  assert.equal(config.panel.buttonLabel, DEFAULTS.panelButtonLabel);
  assert.equal(config.panel.description, 'Abra aqui');
});

test('normalizar é idempotente — a config salva relê igual', () => {
  const once = normalizeTicketConfig({
    maxOpenPerUser: 7,
    panel: { channelId: CHANNEL, messageId: MESSAGE, color: '#ff0000' },
    permissions: { staffRoleIds: [ROLE_A] },
    behavior: { deleteDelaySeconds: 12 },
  });

  assert.deepEqual(normalizeTicketConfig(JSON.parse(JSON.stringify(once))), once);
});

test('colunas antigas de guild_config viram config equivalente', () => {
  const config = legacyTicketConfig({
    ticket_category_id: CATEGORY,
    ticket_panel_channel_id: CHANNEL,
    ticket_log_channel_id: CHANNEL,
  });

  assert.equal(config.defaultParentCategoryId, CATEGORY);
  assert.equal(config.logChannelId, CHANNEL);
  assert.equal(config.panel.channelId, CHANNEL);
  // A coluna antiga não guardava a mensagem publicada.
  assert.equal(config.panel.messageId, null);
  assert.equal(config.enabled, true);
});

test('linha ausente ou vazia não lança', () => {
  assert.deepEqual(legacyTicketConfig(null), normalizeTicketConfig({}));
  assert.deepEqual(legacyTicketConfig({}), normalizeTicketConfig({}));
});
