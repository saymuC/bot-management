// @ts-check
/**
 * Configuração do sistema de tickets, num JSON em `guild_config.ticket_config`.
 *
 * Mesmo padrão do Levels, do Welcome e da Verificação: tudo passa pelo
 * normalizador na leitura e na escrita, então config antiga, corrompida ou
 * editada à mão nunca derruba o runtime nem impede o painel de abrir para
 * consertá-la. Nada aqui lança — campo inválido volta ao default.
 *
 * As categorias continuam na tabela `ticket_categories`: são entidades
 * listáveis e editáveis, não aparência. Este arquivo só cuida da configuração
 * do servidor.
 */

const { getGuildConfig, setGuildConfig } = require('../../database/db');
// Mesma semântica de "sim"/"1" que os modais do Discord produzem; a função é
// genérica e já existe, não vale reescrever.
const { normalizeBool } = require('../levels/config');
const settings = require('../../config/settings');

/** @typedef {ReturnType<typeof normalizeTicketConfig>} TicketConfig */

const LIMITS = Object.freeze({
  maxOpenPerUser: { min: 1, max: 20 },
  deleteDelaySeconds: { min: 0, max: 300 },
  // Teto dos role selects do Discord.
  roleIds: 25,
});

const DEFAULTS = Object.freeze({
  enabled: true,
  maxOpenPerUser: settings.ticket.maxOpenPerUser,
  panelButtonLabel: 'Abrir ticket',
  allowUserSoftClose: true,
  requireClaimBeforeFinalClose: false,
  pingSupportRole: true,
  // Sem "apagar o canal?": o encerramento definitivo sempre apaga, e o
  // transcript no log é a cópia que fica. O ajuste é só o atraso.
  deleteDelaySeconds: 5,
  sendRatingDm: true,
  createTranscript: true,
  allowReopen: true,
});

const isSnowflake = (value) => /^\d{17,20}$/.test(String(value ?? ''));

/** Snowflake válido ou `null` — usado para canal, categoria e mensagem. */
const normalizeId = (value) => (isSnowflake(value) ? String(value) : null);

/** Texto limpo e cortado no limite; vazio cai no fallback. */
function normalizeText(value, max, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : fallback;
}

/** Inteiro dentro da faixa; entrada não numérica volta ao default. */
function clampInt(raw, { min, max }, fallback) {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Ids únicos e válidos, com teto. Descarta silenciosamente o que não presta. */
function normalizeIds(raw, max = LIMITS.roleIds) {
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((item) => String(item ?? '')).filter(isSnowflake))].slice(0, max);
}

/**
 * Config inteira normalizada. Nunca lança: entrada ruim vira default.
 * @param {unknown} raw
 */
function normalizeTicketConfig(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
  const panel = source.panel && typeof source.panel === 'object' ? source.panel : {};
  const permissions = source.permissions && typeof source.permissions === 'object' ? source.permissions : {};
  const behavior = source.behavior && typeof source.behavior === 'object' ? source.behavior : {};

  const channelId = normalizeId(panel.channelId);

  return {
    enabled: normalizeBool(source.enabled, DEFAULTS.enabled),
    maxOpenPerUser: clampInt(source.maxOpenPerUser, LIMITS.maxOpenPerUser, DEFAULTS.maxOpenPerUser),
    logChannelId: normalizeId(source.logChannelId),
    defaultParentCategoryId: normalizeId(source.defaultParentCategoryId),
    panel: {
      channelId,
      // Mensagem sem canal é referência órfã: republicar precisa dos dois, e
      // guardar só o id levaria a uma edição num canal que não sabemos qual é.
      messageId: channelId ? normalizeId(panel.messageId) : null,
      title: normalizeText(panel.title, 256),
      description: normalizeText(panel.description, 4000),
      color: normalizeText(panel.color, 32),
      buttonLabel: normalizeText(panel.buttonLabel, 80, DEFAULTS.panelButtonLabel),
      buttonEmoji: normalizeText(panel.buttonEmoji, 64),
    },
    permissions: {
      staffRoleIds: normalizeIds(permissions.staffRoleIds),
      managerRoleIds: normalizeIds(permissions.managerRoleIds),
      allowUserSoftClose: normalizeBool(permissions.allowUserSoftClose, DEFAULTS.allowUserSoftClose),
      requireClaimBeforeFinalClose: normalizeBool(
        permissions.requireClaimBeforeFinalClose,
        DEFAULTS.requireClaimBeforeFinalClose
      ),
    },
    behavior: {
      pingSupportRole: normalizeBool(behavior.pingSupportRole, DEFAULTS.pingSupportRole),
      deleteDelaySeconds: clampInt(
        behavior.deleteDelaySeconds,
        LIMITS.deleteDelaySeconds,
        DEFAULTS.deleteDelaySeconds
      ),
      sendRatingDm: normalizeBool(behavior.sendRatingDm, DEFAULTS.sendRatingDm),
      createTranscript: normalizeBool(behavior.createTranscript, DEFAULTS.createTranscript),
      allowReopen: normalizeBool(behavior.allowReopen, DEFAULTS.allowReopen),
    },
  };
}

/**
 * Config equivalente às colunas antigas de `guild_config`.
 *
 * Serve os servidores configurados pelos comandos separados (`/ticket-panel`,
 * `/setup-ticket-logs`) antes de existir `ticket_config`. A conversão acontece
 * na leitura e não é persistida: gravar aqui transformaria toda leitura de um
 * servidor sem tickets numa escrita no banco.
 *
 * `ticket_panel_channel_id` só guardava o canal, então o painel migrado nasce
 * sem `messageId` — o primeiro "publicar/atualizar" vai postar uma mensagem
 * nova em vez de editar a antiga.
 *
 * @param {Record<string, any>|null|undefined} row linha de `guild_config`
 */
function legacyTicketConfig(row) {
  return normalizeTicketConfig({
    defaultParentCategoryId: row?.ticket_category_id,
    logChannelId: row?.ticket_log_channel_id,
    panel: { channelId: row?.ticket_panel_channel_id },
  });
}

/**
 * Config do servidor, sempre normalizada.
 * @param {string} guildId
 * @returns {TicketConfig}
 */
function getTicketConfig(guildId) {
  const row = getGuildConfig(guildId);
  if (!row?.ticket_config) return legacyTicketConfig(row);

  try {
    return normalizeTicketConfig(JSON.parse(row.ticket_config));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[tickets] JSON de configuração inválido, usando padrão:', motivo);
    return legacyTicketConfig(row);
  }
}

/**
 * Persiste sem mutar o objeto recebido e devolve a versão normalizada.
 * @param {string} guildId
 * @param {unknown} config
 * @returns {TicketConfig}
 */
function saveTicketConfig(guildId, config) {
  const normalized = normalizeTicketConfig(config);
  setGuildConfig(guildId, 'ticket_config', JSON.stringify(normalized));
  return normalized;
}

/**
 * Grava uma alteração pontual. Imutável e raso: para mexer em `panel`,
 * `permissions` ou `behavior`, passe a seção inteira já recomposta.
 *
 * @param {string} guildId
 * @param {Partial<TicketConfig>} changes
 */
function updateTicketConfig(guildId, changes) {
  return saveTicketConfig(guildId, { ...getTicketConfig(guildId), ...changes });
}

/**
 * O canal de logs em uso, com o fallback para o canal geral do servidor.
 * @param {string} guildId
 * @returns {string|null}
 */
function resolveTicketLogChannelId(guildId) {
  const config = getTicketConfig(guildId);
  if (config.logChannelId) return config.logChannelId;
  return normalizeId(getGuildConfig(guildId)?.log_channel_id);
}

module.exports = {
  LIMITS,
  DEFAULTS,
  normalizeTicketConfig,
  legacyTicketConfig,
  getTicketConfig,
  saveTicketConfig,
  updateTicketConfig,
  resolveTicketLogChannelId,
};
