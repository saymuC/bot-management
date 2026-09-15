/**
 * Diagnóstico da config de tickets.
 *
 * O painel só é honesto se ele acusar o que está salvo e inerte: cargo apagado,
 * categoria que não existe mais, bot sem Gerenciar Canais, exigência de claim num
 * servidor sem equipe. Um aviso que deixa de aparecer é um admin convencido de
 * que o atendimento funciona enquanto nenhum ticket abre.
 *
 * O `guild` é de mentira — só os caches, `members.me` e `permissionsFor` são
 * lidos. O `guild_id` reservado (não é snowflake) mantém as leituras de banco
 * (canal de logs geral, cargos de suporte das categorias) vazias.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { PermissionFlagsBits } = require('discord.js');
const { normalizeTicketConfig } = require('../utils/tickets/config');
const { ticketConfigWarnings } = require('../utils/tickets/diagnostics');

const GUILD = 'test-tickets-diagnostics';
const CHANNEL = '200000000000000001';
const PARENT = '200000000000000009';
const MESSAGE = '300000000000000001';
const ROLE = '100000000000000001';

/**
 * @param {{ channels?: string[], roles?: string[], me?: boolean, canPost?: boolean }} opts
 */
const fakeGuild = ({ channels = [], roles = [], me = true, canPost = true } = {}) => {
  const guild = {
    id: GUILD,
    channels: { cache: new Map() },
    roles: { cache: new Map(roles.map((id) => [id, { id }])) },
    members: { me: me ? { permissions: { has: () => true } } : null },
  };
  for (const id of channels) {
    guild.channels.cache.set(id, {
      id,
      toString: () => `<#${id}>`,
      permissionsFor: () => ({ has: () => canPost }),
    });
  }
  return guild;
};

/** Config completa e sadia: é dela que cada teste tira uma peça. */
const healthy = (extra = {}) =>
  normalizeTicketConfig({
    panel: { channelId: CHANNEL, messageId: MESSAGE },
    logChannelId: CHANNEL,
    ...extra,
  });

const CATEGORIES = [{ label: 'Suporte', target_category_id: PARENT, support_role_id: ROLE }];

const has = (warnings, pattern) => warnings.some((w) => pattern.test(w));

test('config completa e servidor íntegro não geram aviso', () => {
  const guild = fakeGuild({ channels: [CHANNEL, PARENT], roles: [ROLE] });
  assert.deepEqual(ticketConfigWarnings(guild, healthy(), CATEGORIES), []);
});

test('config vazia acusa sistema sem painel, sem categoria e sem log', () => {
  const warnings = ticketConfigWarnings(fakeGuild(), normalizeTicketConfig({}), []);

  assert.ok(has(warnings, /nenhuma categoria/));
  assert.ok(has(warnings, /painel público ainda não foi publicado/));
  assert.ok(has(warnings, /sem canal de logs/));
});

test('sistema desativado é o primeiro aviso', () => {
  const guild = fakeGuild({ channels: [CHANNEL, PARENT], roles: [ROLE] });
  const warnings = ticketConfigWarnings(guild, healthy({ enabled: false }), CATEGORIES);
  assert.match(warnings[0], /desativado/);
});

test('bot sem Gerenciar Canais é acusado', () => {
  const guild = fakeGuild({ channels: [CHANNEL, PARENT], roles: [ROLE] });
  guild.members.me.permissions.has = (flag) => flag !== PermissionFlagsBits.ManageChannels;

  assert.ok(has(ticketConfigWarnings(guild, healthy(), CATEGORIES), /Gerenciar Canais/));
});

test('canal apagado e sem permissão são avisos distintos', () => {
  const semCanal = ticketConfigWarnings(fakeGuild({ roles: [ROLE] }), healthy(), CATEGORIES);
  assert.ok(has(semCanal, /canal do painel público não existe mais/));
  assert.ok(has(semCanal, /canal de logs não existe mais/));

  const semPermissao = ticketConfigWarnings(
    fakeGuild({ channels: [CHANNEL, PARENT], roles: [ROLE], canPost: false }),
    healthy(),
    CATEGORIES
  );
  assert.ok(has(semPermissao, /para publicar o painel/));
  assert.ok(has(semPermissao, /anexar transcripts/));
});

test('categoria e cargo apagados da categoria citam o nome dela', () => {
  const warnings = ticketConfigWarnings(fakeGuild({ channels: [CHANNEL] }), healthy(), CATEGORIES);

  assert.ok(has(warnings, /categoria do Discord apagada em: \*\*Suporte\*\*/));
  assert.ok(has(warnings, /cargo de suporte apagado em: \*\*Suporte\*\*/));
});

test('cargos de atendimento e gerência apagados são acusados', () => {
  const guild = fakeGuild({ channels: [CHANNEL, PARENT], roles: [ROLE] });
  const config = healthy({
    permissions: { staffRoleIds: ['100000000000000002'], managerRoleIds: ['100000000000000003'] },
  });
  const warnings = ticketConfigWarnings(guild, config, CATEGORIES);

  assert.ok(has(warnings, /cargo de atendimento apagado/));
  assert.ok(has(warnings, /cargo de gerência apagado/));
});

test('exigir claim sem cargo de atendimento tranca o ticket', () => {
  const guild = fakeGuild({ channels: [CHANNEL, PARENT], roles: [ROLE] });
  const config = healthy({ permissions: { requireClaimBeforeFinalClose: true } });
  assert.ok(has(ticketConfigWarnings(guild, config, CATEGORIES), /só administradores conseguirão atender/));

  // Com equipe definida o aviso sai de cena.
  const comEquipe = healthy({
    permissions: { requireClaimBeforeFinalClose: true, staffRoleIds: [ROLE] },
  });
  assert.equal(has(ticketConfigWarnings(guild, comEquipe, CATEGORIES), /conseguirão atender/), false);
});
