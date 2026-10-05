// @ts-check
const MAX_BALANCE = 1_000_000_000;
const DAILY = Object.freeze({ min: 300, max: 500, cooldownMs: 24 * 60 * 60 * 1000 });
const WORK = Object.freeze({ min: 150, max: 300, cooldownMs: 30 * 60 * 1000 });
const { getGuildConfig } = require('../database/db');
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

module.exports = { MAX_BALANCE, DAILY, WORK, DEFAULT, getEconomyConfig };
