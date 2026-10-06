const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../database/db');
const repo = require('../utils/economy/repository');
const { changeBalance, claimReward, purchaseItem } = require('../utils/economy/service');
const { MAX_BALANCE, DAILY, WORK } = require('../config/economy');
const { getEconomyConfig, saveEconomyConfig } = require('../config/economy');
const { setGuildConfig } = require('../database/db');

const GUILD = 'test-economy';
const OTHER = 'test-economy-other';
const USER = 'user-a';
function cleanup() {
  db.prepare('DELETE FROM guild_config WHERE guild_id IN (?, ?)').run(GUILD, OTHER);
  for (const table of ['economy_inventory', 'economy_cooldowns', 'economy_transactions', 'economy_accounts']) {
    db.prepare(`DELETE FROM ${table} WHERE guild_id IN (?, ?)`).run(GUILD, OTHER);
  }
}
test.before(cleanup);
test.after(cleanup);

test('saldo, extrato, limites e isolamento por servidor', () => {
  cleanup();
  assert.equal(repo.getBalance(GUILD, USER), 0);
  assert.equal(repo.participantCount(GUILD), 0);
  assert.equal(changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount: 200, source: 'test' }).balance, 200);
  assert.equal(changeBalance({ guildId: GUILD, userId: USER, operation: 'remove', amount: 100, source: 'test' }).balance, 100);
  assert.equal(changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 500, source: 'test' }).balance, 500);
  assert.equal(repo.getBalance(OTHER, USER), 0);
  assert.deepEqual(repo.getTransactions(GUILD, USER).map((row) => row.amount), [400, -100, 200]);
  assert.throws(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'remove', amount: 501, source: 'test' }), RangeError);
  for (const amount of [-1, 1.5, NaN, MAX_BALANCE + 1]) {
    assert.throws(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount, source: 'test' }));
  }
  assert.throws(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount: MAX_BALANCE, source: 'test' }), RangeError);
  assert.equal(repo.getBalance(GUILD, USER), 500);
  assert.equal(repo.getTransactions(GUILD, USER).length, 3);
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 0, source: 'test' });
  assert.equal(repo.getBalance(GUILD, USER), 0);
  assert.equal(repo.participantCount(GUILD), 0);
  assert.equal(repo.rankOf(GUILD, USER), null);
  assert.deepEqual(repo.leaderboardPage(GUILD, 10, 0), []);
});

test('configuração por servidor cai nos defaults quando inválida e rege os ganhos', () => {
  cleanup();
  assert.equal(getEconomyConfig(GUILD).dailyMin, DAILY.min);
  setGuildConfig(GUILD, 'economy_config', '{');
  assert.equal(getEconomyConfig(GUILD).workMin, WORK.min);
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ dailyMin: 8, dailyMax: 8, enabled: true }));
  assert.equal(claimReward({ guildId: GUILD, userId: USER, action: 'daily', now: 1000 }).reward, 8);
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ enabled: false }));
  assert.throws(() => claimReward({ guildId: GUILD, userId: USER, action: 'work' }), /desativada/);
  assert.throws(() => purchaseItem({ guildId: GUILD, userId: USER, itemId: 'cafe' }), /desativada/);
  assert.equal(getEconomyConfig(OTHER).enabled, true);
});

test('edição administrativa valida pares e preserva configuração anterior no erro', () => {
  cleanup();
  saveEconomyConfig(GUILD, { dailyMin: 420, dailyMax: 480, currencyName: 'créditos' });
  assert.equal(getEconomyConfig(GUILD).currencyName, 'créditos');
  for (const changes of [
    { dailyMin: 600 }, { workCooldownMinutes: 0 }, { currencyEmoji: 'não é emoji' },
    { currencyName: '@everyone' }, { dailyMax: NaN }, { unknown: 1 },
  ]) {
    assert.throws(() => saveEconomyConfig(GUILD, changes));
    assert.equal(getEconomyConfig(GUILD).dailyMin, 420);
    assert.equal(getEconomyConfig(GUILD).currencyName, 'créditos');
  }
  saveEconomyConfig(GUILD, { currencyEmoji: null, enabled: false });
  assert.equal(getEconomyConfig(GUILD).enabled, false);
  assert.equal(getEconomyConfig(OTHER).dailyMin, DAILY.min);
});

test('daily e trabalho respeitam cooldown persistente e não duplicam pagamento', () => {
  cleanup();
  const params = { guildId: GUILD, userId: USER, action: 'daily', random: () => 0, now: 1000 };
  assert.equal(claimReward(params).reward, DAILY.min);
  assert.equal(claimReward(params).retryAt, 1000 + DAILY.cooldownMs);
  assert.equal(repo.getBalance(GUILD, USER), DAILY.min);
  assert.equal(repo.getTransactions(GUILD, USER).length, 1);
  assert.equal(claimReward({ ...params, now: 1000 + DAILY.cooldownMs }).reward, DAILY.min);
  const work = claimReward({ ...params, action: 'work', random: () => 0.1 });
  assert.ok(work.job);
  assert.ok(work.reward >= WORK.min && work.reward <= WORK.max);
  assert.equal(claimReward({ ...params, action: 'work' }).reward, 0);
  assert.equal(db.prepare('SELECT expires_at FROM economy_cooldowns WHERE guild_id = ? AND user_id = ? AND action = ?').get(GUILD, USER, 'daily').expires_at, 1000 + DAILY.cooldownMs * 2);
});

test('compras são atômicas mesmo se o inventário falhar', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  assert.throws(() => purchaseItem({ guildId: GUILD, userId: USER, itemId: 'coroa' }), RangeError);
  assert.equal(repo.getInventory(GUILD, USER).length, 0);
  purchaseItem({ guildId: GUILD, userId: USER, itemId: 'cafe' });
  purchaseItem({ guildId: GUILD, userId: USER, itemId: 'cafe' });
  assert.equal(repo.getBalance(GUILD, USER), 700);
  assert.deepEqual(repo.getInventory(GUILD, USER), [{ item_id: 'cafe', quantity: 2 }]);
  db.exec(`CREATE TRIGGER IF NOT EXISTS test_economy_fail BEFORE INSERT ON economy_inventory BEGIN SELECT RAISE(ABORT, 'test'); END`);
  try {
    assert.throws(() => purchaseItem({ guildId: GUILD, userId: USER, itemId: 'pizza' }));
    assert.equal(repo.getBalance(GUILD, USER), 700);
    assert.equal(repo.getTransactions(GUILD, USER).length, 3);
  } finally {
    db.exec('DROP TRIGGER test_economy_fail');
  }
});

test('ordem do ranking e escritas concorrentes não perdem saldo', async () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  await Promise.all([
    Promise.resolve().then(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount: 200, source: 'test' })),
    Promise.resolve().then(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'remove', amount: 300, source: 'test' })),
  ]);
  assert.equal(repo.getBalance(GUILD, USER), 900);
  changeBalance({ guildId: GUILD, userId: 'user-b', operation: 'set', amount: 900, source: 'test' });
  assert.deepEqual(repo.leaderboardPage(GUILD, 10, 0).map((row) => row.user_id), [USER, 'user-b']);
  assert.equal(repo.rankOf(GUILD, 'user-b'), 2);
  assert.equal(repo.rankOf(GUILD, 'unknown'), null);
});
