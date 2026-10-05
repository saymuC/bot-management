// @ts-check
const repository = require('./repository');
const { MAX_BALANCE, DAILY, WORK, getEconomyConfig } = require('../../config/economy');
const { ITEMS } = require('./shop');
const { JOBS } = require('./jobs');

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
  if (!settings.enabled) throw new Error('Economia desativada neste servidor.');
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
  if (!getEconomyConfig(guildId).enabled) throw new Error('Economia desativada neste servidor.');
  const item = ITEMS.find((entry) => entry.id === itemId);
  if (!item) throw new Error('Item desconhecido.');
  const result = repository.applyBalance(guildId, userId, (balance) => {
    if (balance < item.price) throw new RangeError('Saldo insuficiente.');
    return { balance: balance - item.price, source: 'shop_purchase', metadata: { itemId }, itemId };
  });
  return { ...result, item };
}

module.exports = { changeBalance, claimReward, purchaseItem };
