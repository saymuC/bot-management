// @ts-check
const repository = require('./repository');
const { MAX_BALANCE, DAILY, WORK, getEconomyConfig } = require('../../config/economy');
const { ITEMS } = require('./shop');
const { JOBS } = require('./jobs');
const { db } = require('../../database/db');
const { changeXp } = require('../levels/service');
const { getLevelsConfig } = require('../levels/config');

const CRIMES = Object.freeze([
  { name: 'furtar um doce da padaria', min: 40, max: 90, xp: 2, caught: 0.12, fine: 0.10 },
  { name: 'roubar uma bicicleta', min: 100, max: 200, xp: 5, caught: 0.20, fine: 0.15 },
  { name: 'assaltar uma barraca de feira', min: 180, max: 320, xp: 8, caught: 0.28, fine: 0.20 },
  { name: 'roubar uma loja', min: 300, max: 500, xp: 12, caught: 0.35, fine: 0.25 },
  { name: 'invadir um cassino', min: 550, max: 900, xp: 20, caught: 0.48, fine: 0.30 },
  { name: 'roubar um banco', min: 1000, max: 1700, xp: 35, caught: 0.65, fine: 0.35 },
]);
const CRIME_COOLDOWN_MS = 30 * 60_000;

class EconomyDisabledError extends Error {
  constructor() { super('A economia está desativada neste servidor.'); }
}

function validateIds(guildId, userId) {
  if (!guildId || !userId) throw new Error('guildId e userId são obrigatórios.');
}

/** @param {number} value */
function validateAmount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_BALANCE) throw new RangeError('Valor monetário inválido.');
}

/** @param {number} min @param {number} max @param {() => number} random */
function rewardBetween(min, max, random) { return min + Math.floor(random() * (max - min + 1)); }

/** @param {{guildId: string, userId: string, operation: 'add'|'remove'|'set', amount: number, source: string, metadata?: object}} params
 * @returns {import('./types').BalanceChange} */
function changeBalance({ guildId, userId, operation, amount, source, metadata }) {
  validateIds(guildId, userId);
  validateAmount(amount);
  if (!['add', 'remove', 'set'].includes(operation) || !source?.trim()) throw new Error('Operação ou origem inválida.');
  const result = repository.applyBalance(guildId, userId, (balance) => {
    const next = operation === 'set' ? amount : balance + (operation === 'add' ? amount : -amount);
    if (next < 0 || next > MAX_BALANCE) throw new RangeError('Saldo insuficiente ou limite excedido.');
    return { balance: next, source, metadata };
  });
  return { guildId, userId, previousBalance: result.previousBalance, balance: result.balance,
    delta: result.balance - result.previousBalance, source };
}

/** @param {{guildId: string, userId: string, action: 'daily'|'work', now?: number, random?: () => number}} params */
function claimReward({ guildId, userId, action, now = Date.now(), random = Math.random }) {
  validateIds(guildId, userId);
  if (!['daily', 'work'].includes(action) || !Number.isSafeInteger(now) || now < 0) throw new Error('Recompensa inválida.');
  const settings = getEconomyConfig(guildId);
  if (!settings.enabled) throw new EconomyDisabledError();
  const config = action === 'daily'
    ? { min: settings.dailyMin, max: settings.dailyMax, cooldownMs: DAILY.cooldownMs }
    : { min: settings.workMin, max: settings.workMax, cooldownMs: settings.workCooldownMinutes * 60_000 };
  const result = repository.applyBalance(guildId, userId, (balance, onCooldown) => {
    if (onCooldown(action, now)) return { balance, source: action,
      cooldown: { action, now, expiresAt: now + config.cooldownMs } };
    const reward = rewardBetween(config.min, config.max, random);
    if (balance + reward > MAX_BALANCE) throw new RangeError('Seu saldo atingiu o limite.');
    return { balance: balance + reward, source: action,
      cooldown: { action, now, expiresAt: now + config.cooldownMs } };
  });
  const job = result.retryAt || action !== 'work' ? null : JOBS[Math.floor(random() * JOBS.length)];
  return { ...result, reward: result.balance - result.previousBalance, job };
}

/** @param {{guildId: string, userId: string, itemId: string}} params */
function purchaseItem({ guildId, userId, itemId }) {
  validateIds(guildId, userId);
  if (!getEconomyConfig(guildId).enabled) throw new EconomyDisabledError();
  const item = ITEMS.find((entry) => entry.id === itemId);
  if (!item) throw new Error('Item desconhecido.');
  const result = repository.applyBalance(guildId, userId, (balance) => {
    if (balance < item.price) throw new RangeError('Saldo insuficiente.');
    return { balance: balance - item.price, source: 'shop_purchase', metadata: { itemId }, itemId };
  });
  return { ...result, item };
}

/** @param {{guildId: string, userId: string, now?: number, random?: () => number}} params */
function commitCrime({ guildId, userId, now = Date.now(), random = Math.random }) {
  validateIds(guildId, userId);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Horário inválido.');
  if (!getEconomyConfig(guildId).enabled) throw new EconomyDisabledError();
  return db.transaction(() => {
    // O sorteio ocorre dentro da transação: cooldown, saldo e XP são confirmados juntos.
    /** @type {{crime: typeof CRIMES[number], caught: boolean} | null} */
    let outcome = null;
    const result = repository.applyBalance(guildId, userId, (balance, onCooldown) => {
      if (onCooldown('crime', now)) return { balance, source: 'crime', cooldown: { action: 'crime', now, expiresAt: now + CRIME_COOLDOWN_MS } };
      const crime = CRIMES[Math.floor(random() * CRIMES.length)];
      const caught = random() < crime.caught;
      outcome = { crime, caught };
      const amount = caught ? -Math.min(balance, Math.ceil(balance * crime.fine))
        : Math.min(rewardBetween(crime.min, crime.max, random), MAX_BALANCE - balance);
      return { balance: balance + amount, source: caught ? 'crime_fine' : 'crime_reward',
        metadata: { crime: crime.name }, cooldown: { action: 'crime', now, expiresAt: now + CRIME_COOLDOWN_MS } };
    });
    if (result.retryAt) return { retryAt: result.retryAt, balance: result.balance, crime: null, caught: false, amount: 0, xp: 0 };
    const selected = /** @type {{crime: typeof CRIMES[number], caught: boolean} | null} */ (outcome);
    if (!selected) throw new Error('Crime não selecionado.');
    const xp = selected.caught || !getLevelsConfig(guildId).enabled ? 0
      : changeXp({ guildId, userId, operation: 'add', amount: selected.crime.xp, source: 'crime' }).delta;
    return { retryAt: null, balance: result.balance, crime: selected.crime.name, caught: selected.caught, amount: result.balance - result.previousBalance, xp };
  }).immediate();
}

module.exports = { EconomyDisabledError, changeBalance, claimReward, purchaseItem, commitCrime, CRIMES, CRIME_COOLDOWN_MS };
