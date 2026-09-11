// @ts-check
/**
 * Configuração do Levels/XP, num JSON em `guild_config.levels_config`.
 *
 * Mesmo padrão do Welcome e do AutoMod: tudo passa pelo normalizador na leitura e
 * na escrita, então config antiga, corrompida ou editada à mão nunca derruba o
 * motor — o campo inválido volta ao default.
 *
 * A normalização é o único lugar que conhece as faixas aceitas, e ela é
 * deliberadamente tolerante em vez de lançar: uma config ruim não pode impedir o
 * admin de abrir o painel para consertá-la.
 */

const { getGuildConfig, setGuildConfig } = require('../../database/db');
const { checkPublicUrl } = require('../remoteImage');
const {
  MAX_LEVEL,
  LIMITS,
  REWARD_MODES,
  THEME_PRESETS,
  ACCENT_COLORS,
  CORNER_STYLES,
  DEFAULT_THEME,
  DEFAULT_CONFIG,
} = require('../../config/levels');

const isSnowflake = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);

/** Ids únicos e válidos, com teto. Descarta silenciosamente o que não presta. */
function normalizeIds(raw, max) {
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((item) => String(item ?? '')).filter(isSnowflake))].slice(0, max);
}

/** Inteiro dentro da faixa; entrada não numérica volta ao default. */
function clampInt(raw, { min, max }, fallback) {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Aceita boolean de verdade e as formas que os modais produzem ("sim", "1"). */
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

/**
 * URL de fundo aceitável, ou `null`.
 *
 * A mesma checagem do `/emoji-add`: só `https` e só endereço público. Guardar
 * uma URL interna aqui seria guardar um pedido que o bot faria sozinho a cada
 * `/top`, e o painel valida na hora de salvar justamente para o admin não
 * descobrir isso pela imagem sem fundo.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeBackgroundUrl(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const checked = checkPublicUrl(raw);
  return checked.ok ? checked.url.toString() : null;
}

/**
 * Frase do topo da imagem: uma linha, cortada no limite.
 *
 * Quebra de linha é removida em vez de recusada — o modal do Discord aceita
 * `Enter` num campo curto, e recusar a config inteira por causa disso seria
 * perder o texto que a pessoa escreveu.
 *
 * @param {unknown} raw
 * @param {number} [maxChars] limite de caracteres; o padrão é o da frase do topo
 * @returns {string|null}
 */
function normalizeHeadline(raw, maxChars = LIMITS.headlineChars) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim().slice(0, maxChars);
  return text || null;
}

/**
 * Cor em `#rrggbb` minúsculo, ou `null`.
 *
 * Aceita as formas que uma pessoa digita — sem `#`, em três dígitos, em
 * maiúsculas — e recusa qualquer outra coisa. É a única porta por onde uma cor
 * escolhida pelo admin chega ao canvas, então recusar em vez de tentar consertar
 * é o comportamento certo: `fillStyle` com string inválida é silenciosamente
 * ignorado pelo canvas, e o resultado seria um cartão faltando cor sem
 * explicação.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
function normalizeHexColor(raw) {
  if (raw === null || raw === undefined) return null;

  const text = String(raw).trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/.test(text)) return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`;
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
  return null;
}

/**
 * Aparência normalizada.
 *
 * Campo a campo: chave fora do catálogo volta ao default, cor inválida vira
 * `null` (o preset assume) e o véu gruda na faixa. Nada aqui lança — a tela de
 * aparência é justamente onde o admin conserta um tema ruim, e ela não pode
 * depender de o tema estar bom.
 *
 * @param {unknown} raw
 * @returns {import('./types').LevelsTheme}
 */
function normalizeTheme(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};

  return {
    preset: Object.hasOwn(THEME_PRESETS, source.preset) ? source.preset : DEFAULT_THEME.preset,
    accent: Object.hasOwn(ACCENT_COLORS, source.accent) ? source.accent : DEFAULT_THEME.accent,
    cardColor: normalizeHexColor(source.cardColor),
    accentColor: normalizeHexColor(source.accentColor),
    veil: clampInt(source.veil, LIMITS.veil, DEFAULT_THEME.veil),
    corners: Object.hasOwn(CORNER_STYLES, source.corners) ? source.corners : DEFAULT_THEME.corners,
    title: normalizeHeadline(source.title, LIMITS.titleChars),
    showAvatars: normalizeBool(source.showAvatars, DEFAULT_THEME.showAvatars),
    showBars: normalizeBool(source.showBars, DEFAULT_THEME.showBars),
    showTexture: normalizeBool(source.showTexture, DEFAULT_THEME.showTexture),
    showShadow: normalizeBool(source.showShadow, DEFAULT_THEME.showShadow),
    showMedals: normalizeBool(source.showMedals, DEFAULT_THEME.showMedals),
    showFooter: normalizeBool(source.showFooter, DEFAULT_THEME.showFooter),
  };
}

/**
 * Recompensas normalizadas: ordenadas por nível, sem nível repetido e sem
 * entrada sem cargo.
 *
 * Nível duplicado é **mesclado** em vez de descartado: duas entradas para o
 * nível 5 quase sempre significam "quero estes dois cargos no 5", e perder a
 * segunda silenciosamente seria a leitura errada.
 *
 * @param {unknown} raw
 * @returns {import('./types').LevelReward[]}
 */
function normalizeRewards(raw) {
  const source = Array.isArray(raw) ? raw : [];
  /** @type {Map<number, string[]>} */
  const byLevel = new Map();

  for (const item of source) {
    if (!item || typeof item !== 'object') continue;

    // Faixa checada, não grudada: `clampInt` transformaria um nível 0 em 1 e a
    // recompensa entraria valendo para todo mundo — nível 0 é onde todos começam.
    const level = Number.parseInt(String(/** @type {any} */ (item).level), 10);
    if (!Number.isFinite(level) || level < 1 || level > MAX_LEVEL) continue;

    // `roleIds` é o formato atual; `roleId` cobre um objeto de nível único.
    const rawRoles = /** @type {any} */ (item).roleIds ?? [/** @type {any} */ (item).roleId];
    const roleIds = normalizeIds(rawRoles, LIMITS.rolesPerReward);
    if (!roleIds.length) continue;

    const merged = [...new Set([...(byLevel.get(level) ?? []), ...roleIds])];
    byLevel.set(level, merged.slice(0, LIMITS.rolesPerReward));
  }

  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .slice(0, LIMITS.rewards)
    .map(([level, roleIds]) => ({ level, roleIds }));
}

/**
 * Config inteira normalizada. Nunca lança: entrada ruim vira default.
 * @param {unknown} raw
 * @returns {import('./types').LevelsConfig}
 */
function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};

  const xpMin = clampInt(source.xpMin, LIMITS.xp, DEFAULT_CONFIG.xpMin);
  const xpMaxRaw = clampInt(source.xpMax, LIMITS.xp, DEFAULT_CONFIG.xpMax);

  return {
    enabled: normalizeBool(source.enabled, DEFAULT_CONFIG.enabled),
    xpMin,
    // `xpMin > xpMax` é config inerte (o sorteio ficaria vazio), então o máximo
    // sobe até o mínimo em vez de os dois voltarem ao default: o admin perde o
    // valor que estava errado, não o que estava certo.
    xpMax: Math.max(xpMin, xpMaxRaw),
    cooldownSeconds: clampInt(source.cooldownSeconds, LIMITS.cooldownSeconds, DEFAULT_CONFIG.cooldownSeconds),
    minUsefulChars: clampInt(source.minUsefulChars, LIMITS.minUsefulChars, DEFAULT_CONFIG.minUsefulChars),
    repeatWindowSeconds: clampInt(
      source.repeatWindowSeconds,
      LIMITS.repeatWindowSeconds,
      DEFAULT_CONFIG.repeatWindowSeconds
    ),
    ignoredChannelIds: normalizeIds(source.ignoredChannelIds, LIMITS.ignoredChannels),
    ignoredRoleIds: normalizeIds(source.ignoredRoleIds, LIMITS.ignoredRoles),
    announceEnabled: normalizeBool(source.announceEnabled, DEFAULT_CONFIG.announceEnabled),
    announceChannelId: isSnowflake(source.announceChannelId) ? source.announceChannelId : null,
    rewardMode: Object.hasOwn(REWARD_MODES, source.rewardMode) ? source.rewardMode : DEFAULT_CONFIG.rewardMode,
    rewards: normalizeRewards(source.rewards),
    backgroundUrl: normalizeBackgroundUrl(source.backgroundUrl),
    headline: normalizeHeadline(source.headline),
    theme: normalizeTheme(source.theme),
  };
}

/**
 * Config do servidor, sempre normalizada.
 * @param {string} guildId
 * @returns {import('./types').LevelsConfig}
 */
function getLevelsConfig(guildId) {
  const row = getGuildConfig(guildId);
  if (!row?.levels_config) return normalizeConfig({});

  try {
    return normalizeConfig(JSON.parse(row.levels_config));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[levels] JSON de configuração inválido, usando padrão:', motivo);
    return normalizeConfig({});
  }
}

/**
 * Persiste sem mutar o objeto recebido e devolve a versão normalizada.
 * @param {string} guildId
 * @param {unknown} config
 * @returns {import('./types').LevelsConfig}
 */
function saveLevelsConfig(guildId, config) {
  const normalized = normalizeConfig(config);
  setGuildConfig(guildId, 'levels_config', JSON.stringify(normalized));
  return normalized;
}

/**
 * Grava uma alteração pontual (imutável: recria o objeto com as sobrescritas).
 * @param {string} guildId
 * @param {Partial<import('./types').LevelsConfig>} changes
 */
function updateLevelsConfig(guildId, changes) {
  return saveLevelsConfig(guildId, { ...getLevelsConfig(guildId), ...changes });
}

/**
 * O canal está fora do sistema?
 *
 * Escolher uma **categoria** ignora os canais dela, e escolher um canal ignora os
 * tópicos dele — mesma leitura das isenções do AutoMod, porque é a expectativa de
 * quem seleciona `#offtopic` num select de canais.
 *
 * @param {import('./types').LevelsConfig} config
 * @param {import('discord.js').GuildBasedChannel|null|undefined} channel
 */
function isChannelIgnored(config, channel) {
  if (!channel || !config.ignoredChannelIds.length) return false;
  if (config.ignoredChannelIds.includes(channel.id)) return true;

  const parentId = /** @type {any} */ (channel).parentId ?? null;
  return Boolean(parentId && config.ignoredChannelIds.includes(parentId));
}

/**
 * O membro tem algum cargo excluído do sistema?
 * @param {import('./types').LevelsConfig} config
 * @param {import('discord.js').GuildMember|null|undefined} member
 */
function isMemberIgnored(config, member) {
  if (!config.ignoredRoleIds.length) return false;
  const ignored = new Set(config.ignoredRoleIds);
  return Boolean(member?.roles?.cache?.some((role) => ignored.has(role.id)));
}

module.exports = {
  normalizeBool,
  normalizeIds,
  normalizeRewards,
  normalizeBackgroundUrl,
  normalizeHeadline,
  normalizeHexColor,
  normalizeTheme,
  normalizeConfig,
  getLevelsConfig,
  saveLevelsConfig,
  updateLevelsConfig,
  isChannelIgnored,
  isMemberIgnored,
};
