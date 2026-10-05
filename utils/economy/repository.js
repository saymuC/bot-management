// @ts-check
const { db } = require('../../database/db');

const balanceStmt = db.prepare('SELECT wallet FROM economy_accounts WHERE guild_id = ? AND user_id = ?');
const upsertStmt = db.prepare(`INSERT INTO economy_accounts (guild_id, user_id, wallet) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET wallet = excluded.wallet, updated_at = CURRENT_TIMESTAMP`);
const transactionStmt = db.prepare(`INSERT INTO economy_transactions
  (guild_id, user_id, type, amount, balance_before, balance_after, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const cooldownStmt = db.prepare('SELECT expires_at FROM economy_cooldowns WHERE guild_id = ? AND user_id = ? AND action = ?');
const setCooldownStmt = db.prepare(`INSERT INTO economy_cooldowns (guild_id, user_id, action, expires_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id, action) DO UPDATE SET expires_at = excluded.expires_at`);
const inventoryStmt = db.prepare(`INSERT INTO economy_inventory (guild_id, user_id, item_id, quantity) VALUES (?, ?, ?, 1)
  ON CONFLICT(guild_id, user_id, item_id) DO UPDATE SET quantity = quantity + 1`);

/** @param {string} guildId @param {string} userId */
function getBalance(guildId, userId) { return balanceStmt.get(guildId, userId)?.wallet ?? 0; }

/** @param {string} guildId @param {string} userId @param {(balance: number, onCooldown: (action: string, now: number) => boolean) => { balance: number, source: string, metadata?: object, cooldown?: { action: string, expiresAt: number, now: number }, itemId?: string }} resolve */
const balanceTransaction = db.transaction((guildId, userId, resolve) => {
  const previousBalance = getBalance(guildId, userId);
  const change = resolve(previousBalance, (action, now) => (cooldownStmt.get(guildId, userId, action)?.expires_at ?? 0) > now);
  if (change.cooldown) {
    const { action, expiresAt, now } = change.cooldown;
    const expires = cooldownStmt.get(guildId, userId, action)?.expires_at ?? 0;
    if (expires > now) return { previousBalance, balance: previousBalance, retryAt: expires };
    setCooldownStmt.run(guildId, userId, action, expiresAt);
  }
  if (change.balance !== previousBalance) {
    upsertStmt.run(guildId, userId, change.balance);
    transactionStmt.run(guildId, userId, change.source, change.balance - previousBalance,
      previousBalance, change.balance, change.metadata ? JSON.stringify(change.metadata) : null);
  }
  if (change.itemId) inventoryStmt.run(guildId, userId, change.itemId);
  return { previousBalance, balance: change.balance, retryAt: null };
});
// BEGIN IMMEDIATE waits for competing writers before reading the old balance.
const applyBalance = (...args) => balanceTransaction.immediate(...args);

const leaderboardStmt = db.prepare('SELECT user_id, wallet FROM economy_accounts WHERE guild_id = ? ORDER BY wallet DESC, user_id ASC LIMIT ? OFFSET ?');
const rankStmt = db.prepare(`SELECT COUNT(*) + 1 AS position FROM economy_accounts
  WHERE guild_id = ? AND (wallet > ? OR (wallet = ? AND user_id < ?))`);
const countStmt = db.prepare('SELECT COUNT(*) AS total FROM economy_accounts WHERE guild_id = ?');
const historyStmt = db.prepare('SELECT * FROM economy_transactions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?');
const itemsStmt = db.prepare('SELECT item_id, quantity FROM economy_inventory WHERE guild_id = ? AND user_id = ? AND quantity > 0 ORDER BY acquired_at, item_id');

/** @param {string} guildId @param {number} limit @param {number} offset */
function leaderboardPage(guildId, limit, offset) { return leaderboardStmt.all(guildId, Math.max(0, limit), Math.max(0, offset)); }
/** @param {string} guildId @param {string} userId */
function rankOf(guildId, userId) {
  const row = balanceStmt.get(guildId, userId);
  return row ? rankStmt.get(guildId, row.wallet, row.wallet, userId).position : null;
}
/** @param {string} guildId */
function participantCount(guildId) { return countStmt.get(guildId).total; }
/** @param {string} guildId @param {string} userId @param {number} [limit] */
function getTransactions(guildId, userId, limit = 20) { return historyStmt.all(guildId, userId, Math.max(0, limit)); }
/** @param {string} guildId @param {string} userId */
function getInventory(guildId, userId) { return itemsStmt.all(guildId, userId); }

module.exports = { getBalance, applyBalance, leaderboardPage, rankOf, participantCount, getTransactions, getInventory };
