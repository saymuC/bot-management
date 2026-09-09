/**
 * Configuração do AutoMod, num JSON em `guild_config.automod_config`.
 *
 * Mesmo padrão do /setup-welcome e do /setup-verify: tudo normalizado na leitura
 * e na escrita, então config antiga, corrompida ou vinda de uma versão anterior
 * do catálogo nunca derruba o motor — cai no default da regra.
 */

const { getGuildConfig, setGuildConfig } = require('../../database/db');
const {
  RULES,
  RULE_KEYS,
  ACTIONS,
  NOTIFY_MODES,
  DEFAULT_MUTE_MS,
  MAX_NOTICE_TTL_MS,
  MIN_NOTICE_TTL_MS,
  ruleDefaults,
} = require('../../config/automodRules');

/** Teto do timeout do Discord: 28 dias. */
const MAX_MUTE_MS = 28 * 24 * 60 * 60 * 1000;

/** Pontos que uma regra pode valer. Teto baixo de propósito: a escada é que escala. */
const MAX_POINTS = 10;

/** Quanto tempo os pontos contam para a escada, por padrão. */
const DEFAULT_POINTS_EXPIRE_HOURS = 24 * 7;

/** Itens de lista (palavras, domínios) por regra — evita um JSON gigante na coluna. */
const MAX_LIST_ITEMS = 200;
const MAX_LIST_ITEM_LENGTH = 100;

/**
 * Escada inicial. Vem preenchida porque é inofensiva enquanto nenhuma regra
 * estiver ligada, e poupa o admin de montar a parte mais chata na mão.
 */
const DEFAULT_LADDER = Object.freeze([
  Object.freeze({ points: 3, action: 'mute', muteMs: 10 * 60 * 1000 }),
  Object.freeze({ points: 5, action: 'mute', muteMs: 60 * 60 * 1000 }),
  Object.freeze({ points: 8, action: 'kick', muteMs: DEFAULT_MUTE_MS }),
]);

const isSnowflake = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);

/** Lista de ids únicos e válidos. Descarta silenciosamente o que não presta. */
const normalizeIds = (raw) => (Array.isArray(raw) ? [...new Set(raw.filter(isSnowflake))] : []);

const clampInt = (raw, { min, max, default: fallback }) => {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
};

/** Aceita boolean de verdade e as formas que o modal produz ("sim", "não", "1"). */
function normalizeBool(raw, fallback) {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw !== 'string') return fallback;

  const text = raw.trim().toLowerCase();
  if (!text) return fallback;
  if (['sim', 's', 'true', '1', 'yes', 'y', 'on', 'ligado'].includes(text)) return true;
  if (['nao', 'não', 'n', 'false', '0', 'no', 'off', 'desligado'].includes(text)) return false;
  return fallback;
}

/** Normaliza uma lista de texto: sem vazios, sem duplicata, minúsculas, com teto. */
function normalizeList(raw) {
  const items = Array.isArray(raw) ? raw : String(raw ?? '').split(/\r?\n/);
  const cleaned = items
    .map((item) => String(item ?? '').trim().toLowerCase().slice(0, MAX_LIST_ITEM_LENGTH))
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, MAX_LIST_ITEMS);
}

/** Limites de uma regra, validados campo a campo contra o catálogo. */
function normalizeLimits(ruleKey, raw) {
  const fields = RULES[ruleKey].fields;
  const source = raw && typeof raw === 'object' ? raw : {};

  return Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      const value = source[name];
      if (field.type === 'list') return [name, normalizeList(value)];
      if (field.type === 'bool') return [name, normalizeBool(value, field.default)];
      return [name, clampInt(value, field)];
    })
  );
}

/**
 * Prazo do aviso no canal, em ms. `0` significa "não apagar" e é um valor
 * legítimo, não ausência — por isso ele não passa pelo `clampInt` comum, que
 * empurraria o zero para o piso.
 */
function normalizeNoticeTtl(raw, fallback) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (value === 0) return 0;
  return Math.min(MAX_NOTICE_TTL_MS, Math.max(MIN_NOTICE_TTL_MS, value));
}

/** Uma regra normalizada: defaults do catálogo com as sobrescritas válidas por cima. */
function normalizeRule(ruleKey, raw) {
  const defaults = ruleDefaults(ruleKey);
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    enabled: normalizeBool(source.enabled, defaults.enabled),
    deleteMessage: normalizeBool(source.deleteMessage, defaults.deleteMessage),
    action: Object.hasOwn(ACTIONS, source.action) ? source.action : defaults.action,
    muteMs: clampInt(source.muteMs, { min: 5000, max: MAX_MUTE_MS, default: defaults.muteMs }),
    points: clampInt(source.points, { min: 0, max: MAX_POINTS, default: defaults.points }),
    notify: Object.hasOwn(NOTIFY_MODES, source.notify) ? source.notify : defaults.notify,
    noticeTtlMs: normalizeNoticeTtl(source.noticeTtlMs, defaults.noticeTtlMs),
    exemptRoleIds: normalizeIds(source.exemptRoleIds),
    exemptChannelIds: normalizeIds(source.exemptChannelIds),
    limits: normalizeLimits(ruleKey, source.limits),
  };
}

/**
 * Degraus da escada: ordenados por pontos, sem pontuação repetida e sem `none`
 * (um degrau que não faz nada só confundiria a leitura do painel).
 */
function normalizeLadder(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const steps = [];

  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const points = clampInt(item.points, { min: 1, max: 100, default: 0 });
    const action = Object.hasOwn(ACTIONS, item.action) ? item.action : 'none';
    if (!points || action === 'none' || seen.has(points)) continue;

    seen.add(points);
    steps.push({
      points,
      action,
      muteMs: clampInt(item.muteMs, { min: 5000, max: MAX_MUTE_MS, default: DEFAULT_MUTE_MS }),
    });
  }

  return steps.sort((a, b) => a.points - b.points);
}

/** Config inteira normalizada. Nunca lança: entrada ruim vira default. */
function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rules = source.rules && typeof source.rules === 'object' ? source.rules : {};

  return {
    enabled: normalizeBool(source.enabled, false),
    logChannelId: isSnowflake(source.logChannelId) ? source.logChannelId : null,
    // Desligado por padrão: nenhum filtro deduz isenção de permissão do Discord.
    // Quem quiser poupar a equipe liga isto ou põe o cargo nas isenções.
    exemptModerators: normalizeBool(source.exemptModerators, false),
    exemptRoleIds: normalizeIds(source.exemptRoleIds),
    exemptChannelIds: normalizeIds(source.exemptChannelIds),
    pointsExpireHours: clampInt(source.pointsExpireHours, {
      min: 1,
      max: 24 * 365,
      default: DEFAULT_POINTS_EXPIRE_HOURS,
    }),
    ladder: source.ladder === undefined ? normalizeLadder(DEFAULT_LADDER) : normalizeLadder(source.ladder),
    rules: Object.fromEntries(RULE_KEYS.map((key) => [key, normalizeRule(key, rules[key])])),
  };
}

/** @returns {ReturnType<typeof normalizeConfig>} */
function getAutomodConfig(guildId) {
  const row = getGuildConfig(guildId);
  if (!row?.automod_config) return normalizeConfig({});

  try {
    return normalizeConfig(JSON.parse(row.automod_config));
  } catch (err) {
    console.error('[automod] JSON de configuração inválido, usando padrão:', err.message);
    return normalizeConfig({});
  }
}

/** Persiste sem mutar o objeto recebido e devolve a versão normalizada. */
function saveAutomodConfig(guildId, config) {
  const normalized = normalizeConfig(config);
  setGuildConfig(guildId, 'automod_config', JSON.stringify(normalized));
  return normalized;
}

/**
 * Grava uma alteração pontual numa regra (imutável: recria o ramo alterado).
 * @param {object} changes campos da regra a sobrescrever
 */
function updateRule(guildId, ruleKey, changes) {
  const config = getAutomodConfig(guildId);
  return saveAutomodConfig(guildId, {
    ...config,
    rules: { ...config.rules, [ruleKey]: { ...config.rules[ruleKey], ...changes } },
  });
}

/** Grava uma alteração na config geral (imutável). */
function updateConfig(guildId, changes) {
  return saveAutomodConfig(guildId, { ...getAutomodConfig(guildId), ...changes });
}

/**
 * Por que o membro está livre desta regra, ou null se não está.
 *
 * As isenções são **só** as do bot: cargo, canal e o interruptor de moderador.
 * Nenhum filtro deduz isenção de permissão do Discord — se alguém deve poder
 * mencionar todos ou mandar link, o cargo ou o canal dele entra numa das listas.
 * A única exceção é opt-in e visível no painel: `exemptModerators`, desligado
 * por padrão, que poupa quem tem `Gerenciar mensagens`.
 *
 * @param {import('discord.js').GuildMember|null} member
 * @param {string|null} channelId
 * @returns {string|null} motivo legível da isenção
 */
function exemptionReason(config, rule, member, channelId) {
  if (config.exemptModerators && member?.permissions?.has('ManageMessages')) return 'moderador';

  const channels = new Set([...config.exemptChannelIds, ...rule.exemptChannelIds]);
  if (channelId && channels.has(channelId)) return 'canal isento';
  // Thread isenta quando o canal-pai é: quem isenta #suporte espera valer nos tópicos dele.
  if (channels.size && member) {
    const parentId = member.guild.channels.cache.get(channelId)?.parentId;
    if (parentId && channels.has(parentId)) return 'categoria/canal-pai isento';
  }

  const roles = new Set([...config.exemptRoleIds, ...rule.exemptRoleIds]);
  if (roles.size && member?.roles?.cache?.some((role) => roles.has(role.id))) return 'cargo isento';

  return null;
}

module.exports = {
  MAX_MUTE_MS,
  MAX_POINTS,
  MAX_LIST_ITEMS,
  DEFAULT_POINTS_EXPIRE_HOURS,
  DEFAULT_LADDER,
  normalizeBool,
  normalizeList,
  normalizeLimits,
  normalizeNoticeTtl,
  normalizeLadder,
  normalizeConfig,
  getAutomodConfig,
  saveAutomodConfig,
  updateRule,
  updateConfig,
  exemptionReason,
};
