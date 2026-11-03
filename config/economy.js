// @ts-check
const MAX_BALANCE = 1_000_000_000;
const DAILY = Object.freeze({ min: 300, max: 500, cooldownMs: 24 * 60 * 60 * 1000 });
const WORK = Object.freeze({ min: 150, max: 300, cooldownMs: 30 * 60 * 1000 });
const { getGuildConfig, setGuildConfig } = require('../database/db');
const { db } = require('../database/db');
const { BOARD_SIZE, payout } = require('../utils/economy/mines/engine');
const MINES_DEFAULT = Object.freeze({ enabled: true, minBet: 50, maxBet: 8_000, maxMines: 8, houseEdgeBps: 300, timeoutSeconds: 300 });
/** @typedef {{ enabled: boolean, minBet: number, maxBet: number, maxMines: number, houseEdgeBps: number, timeoutSeconds: number }} MinesConfig */
/** @typedef {{ enabled: boolean, dailyMin: number, dailyMax: number, workMin: number, workMax: number, workCooldownMinutes: number, currencyName: string, currencyEmoji: string|null, mines: MinesConfig }} EconomyConfig */
const DEFAULT = Object.freeze({ enabled: true, dailyMin: DAILY.min, dailyMax: DAILY.max,
  workMin: WORK.min, workMax: WORK.max, workCooldownMinutes: 30, currencyName: 'moedas', currencyEmoji: null,
  mines: MINES_DEFAULT });

/** @param {string} guildId */
function getEconomyConfig(guildId) {
  let stored;
  try { stored = JSON.parse(getGuildConfig(guildId)?.economy_config ?? 'null'); } catch { stored = null; }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT, mines: { ...MINES_DEFAULT } };
  /** @type {EconomyConfig} */
  const result = { ...DEFAULT, mines: { ...MINES_DEFAULT } };
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
  const mines = stored.mines && typeof stored.mines === 'object' && !Array.isArray(stored.mines) ? stored.mines : {};
  result.mines = { ...MINES_DEFAULT,
    enabled: typeof mines.enabled === 'boolean' ? mines.enabled : MINES_DEFAULT.enabled,
    minBet: Number.isSafeInteger(mines.minBet) && mines.minBet > 0 && mines.minBet <= MAX_BALANCE ? mines.minBet : MINES_DEFAULT.minBet,
    maxBet: Number.isSafeInteger(mines.maxBet) && mines.maxBet > 0 && mines.maxBet <= MAX_BALANCE ? mines.maxBet : MINES_DEFAULT.maxBet,
    maxMines: Number.isSafeInteger(mines.maxMines) && mines.maxMines >= 1 && mines.maxMines <= 8 ? mines.maxMines : MINES_DEFAULT.maxMines,
    houseEdgeBps: Number.isSafeInteger(mines.houseEdgeBps) && mines.houseEdgeBps >= 0 && mines.houseEdgeBps <= 9999 ? mines.houseEdgeBps : MINES_DEFAULT.houseEdgeBps,
    timeoutSeconds: Number.isSafeInteger(mines.timeoutSeconds) && mines.timeoutSeconds >= 60 && mines.timeoutSeconds <= 3600 ? mines.timeoutSeconds : MINES_DEFAULT.timeoutSeconds,
  };
  if (result.mines.minBet > result.mines.maxBet) result.mines.maxBet = result.mines.minBet;
  return result;
}

/** @param {string} guildId @param {Partial<Omit<EconomyConfig, 'mines'>> & { mines?: Partial<MinesConfig> }} changes */
function saveEconomyConfig(guildId, changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
      Object.keys(changes).some((key) => !Object.hasOwn(DEFAULT, key))) throw new Error('Campo de economia inválido.');
  const config = getEconomyConfig(guildId);
  /** @type {EconomyConfig} */
  const next = { ...config, ...changes, mines: changes.mines ? { ...config.mines, ...changes.mines } : config.mines };
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
  if (Object.hasOwn(changes, 'mines')) {
    if (!changes.mines || typeof changes.mines !== 'object' || Array.isArray(changes.mines) ||
        Object.keys(changes.mines).some((key) => !Object.hasOwn(MINES_DEFAULT, key))) throw new Error('Configuração de Mines inválida.');
    const mines = { ...next.mines, ...changes.mines };
    if (typeof mines.enabled !== 'boolean' || !Number.isSafeInteger(mines.minBet) || !Number.isSafeInteger(mines.maxBet) ||
        mines.minBet < 1 || mines.minBet > mines.maxBet || mines.maxBet > MAX_BALANCE ||
        !Number.isSafeInteger(mines.maxMines) || mines.maxMines < 1 || mines.maxMines > 8 ||
        !Number.isSafeInteger(mines.houseEdgeBps) || mines.houseEdgeBps < 0 || mines.houseEdgeBps > 9999 ||
        !Number.isSafeInteger(mines.timeoutSeconds) || mines.timeoutSeconds < 60 || mines.timeoutSeconds > 3600) {
      throw new Error('Configuração de Mines fora dos limites permitidos.');
    }
    next.mines = mines;
  }
  if (next.mines.maxMines > Math.min(8, Math.floor(BOARD_SIZE - 1))) throw new Error('Quantidade máxima de minas inválida.');
  for (let mines = 1; mines <= next.mines.maxMines; mines += 1) {
    if (payout(next.mines.maxBet, mines, BOARD_SIZE - mines, next.mines.houseEdgeBps) > MAX_BALANCE) {
      throw new Error('A configuração permite pagamentos acima do limite da carteira.');
    }
  }
  const save = () => {
    setGuildConfig(guildId, 'economy_config', JSON.stringify(next));
    if ((config.enabled && !next.enabled) || (config.mines.enabled && !next.mines.enabled)) {
      require('../utils/economy/mines/service').refundAllActive(guildId, Date.now(), 'refunded');
    }
  };
  db.transaction(save).immediate();
  return next;
}

module.exports = { MAX_BALANCE, DAILY, WORK, MINES_DEFAULT, DEFAULT, getEconomyConfig, saveEconomyConfig };
