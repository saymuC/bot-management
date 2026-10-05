// @ts-check
const MAX_BALANCE = 1_000_000_000;
const DAILY = Object.freeze({ min: 300, max: 500, cooldownMs: 24 * 60 * 60 * 1000 });
const WORK = Object.freeze({ min: 150, max: 300, cooldownMs: 30 * 60 * 1000 });
const { getGuildConfig, setGuildConfig } = require('../database/db');
const DEFAULT = Object.freeze({ enabled: true, dailyMin: DAILY.min, dailyMax: DAILY.max,
  workMin: WORK.min, workMax: WORK.max, workCooldownMinutes: 30, currencyName: 'moedas', currencyEmoji: null });

/** @param {string} guildId */
function getEconomyConfig(guildId) {
  let stored;
  try { stored = JSON.parse(getGuildConfig(guildId)?.economy_config ?? 'null'); } catch { stored = null; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT };
  /** @type {{enabled: boolean, dailyMin: number, dailyMax: number, workMin: number, workMax: number, workCooldownMinutes: number, currencyName: string, currencyEmoji: string|null}} */
  const result = { ...DEFAULT };
  if (typeof stored.enabled === 'boolean') result.enabled = stored.enabled;
  if (typeof stored.currencyName === 'string' && /^[\p{L}\p{N} ]{1,24}$/u.test(stored.currencyName)) result.currencyName = stored.currencyName;
  if (typeof stored.currencyEmoji === 'string' && stored.currencyEmoji.length <= 80) {
    const { parseEmojiInput } = require('../utils/emojis');
    if (parseEmojiInput(stored.currencyEmoji).ok) result.currencyEmoji = stored.currencyEmoji;
  }
  for (const key of ['dailyMin', 'dailyMax', 'workMin', 'workMax', 'workCooldownMinutes']) {
    if (Number.isSafeInteger(stored[key]) && stored[key] > 0 && stored[key] <= MAX_BALANCE) result[key] = stored[key];
  }
  if (result.dailyMin > result.dailyMax) result.dailyMax = result.dailyMin;
  if (result.workMin > result.workMax) result.workMax = result.workMin;
  result.workCooldownMinutes = Math.min(result.workCooldownMinutes, 1440);
  return result;
}

/** @param {string} guildId @param {object} changes */
function saveEconomyConfig(guildId, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
      Object.keys(changes).some((key) => !Object.hasOwn(DEFAULT, key))) throw new Error('Campo de economia inválido.');
  const config = getEconomyConfig(guildId);
  const next = { ...config, ...changes };
  if (typeof next.enabled !== 'boolean') throw new Error('Status inválido.');
  if (typeof next.currencyName !== 'string' || !/^[\p{L}\p{N} ]{1,24}$/u.test(next.currencyName)) {
    throw new Error('Nome da moeda inválido (1 a 24 letras, números ou espaços).');
  }
  const { parseEmojiInput } = require('../utils/emojis');
  if (next.currencyEmoji !== null && !parseEmojiInput(next.currencyEmoji).ok) throw new Error('Emoji da moeda inválido.');
  for (const [min, max] of [['dailyMin', 'dailyMax'], ['workMin', 'workMax']]) {
    if (!Number.isSafeInteger(next[min]) || !Number.isSafeInteger(next[max]) ||
        next[min] < 1 || next[min] > next[max] || next[max] > MAX_BALANCE) {
      throw new Error('Recompensa inválida: mínimo deve ser positivo e não exceder o máximo.');
    }
  }
  if (!Number.isSafeInteger(next.workCooldownMinutes) || next.workCooldownMinutes < 1 || next.workCooldownMinutes > 1440) {
    throw new Error('Cooldown de trabalho deve ser de 1 a 1440 minutos.');
  }
  setGuildConfig(guildId, 'economy_config', JSON.stringify(next));
  return next;
}

module.exports = { MAX_BALANCE, DAILY, WORK, DEFAULT, getEconomyConfig, saveEconomyConfig };
