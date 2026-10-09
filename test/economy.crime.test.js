const test = require('node:test');
const assert = require('node:assert/strict');
const { db, setGuildConfig } = require('../database/db');
const { setGuildEmoji, resetGuildEmojis } = require('../utils/emojis');
const { ITEMS } = require('../utils/economy/shop');
const { JOBS } = require('../utils/economy/jobs');
const { changeBalance, claimReward, commitCrime, CRIMES, CRIME_COOLDOWN_MS } = require('../utils/economy/service');
const economy = require('../utils/economy/repository');
const { getUserState } = require('../utils/levels/service');
const command = require('../commands/economy/crime');

const GUILD = 'test-economy-crime';
const USER = 'test-criminal';

function cleanup() {
  resetGuildEmojis();
  for (const table of ['economy_inventory', 'economy_cooldowns', 'economy_transactions', 'economy_accounts', 'user_levels']) {
    db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(GUILD);
  }
  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(GUILD);
}
test.before(cleanup);
test.after(cleanup);

function interaction() {
  const calls = [];
  return { guild: { id: GUILD }, user: { id: USER }, deferred: true, calls,
    editReply: async (payload) => { calls.push(payload); } };
}

test('loja e trabalhos têm variedade, emojis registrados e mensagens alternativas', () => {
  const { REGISTRY } = require('../utils/emojis');
  assert.ok(ITEMS.length > 10 && ITEMS.length <= 25);
  assert.ok(JOBS.length > 10);
  assert.equal(new Set(ITEMS.map((item) => item.id)).size, ITEMS.length);
  assert.ok(ITEMS.every((item) => REGISTRY[item.emojiKey] && item.price > 0));
  assert.ok(JOBS.every((job) => REGISTRY[job.emojiKey] && job.messages.length === 2));
  for (let n = 0; n < JOBS.length; n += 1) {
    const result = claimReward({ guildId: GUILD, userId: USER, action: 'work', now: 1 + n * 1_800_000,
      roll: (() => { let count = 0; return (min) => count++ === 0 ? min : n; })() });
    assert.equal(result.job.name, JOBS[n].name);
  }
});

test('cada crime tem risco próprio; sucesso credita saldo e XP com cooldown', () => {
  cleanup();
  setGuildConfig(GUILD, 'levels_config', JSON.stringify({ enabled: true }));
  assert.ok(CRIMES.length >= 6);
  for (let n = 0; n < CRIMES.length; n += 1) {
    const crime = CRIMES[n];
    const now = 1000 + n * CRIME_COOLDOWN_MS;
    const rolls = [n, 99, crime.min];
    const result = commitCrime({ guildId: GUILD, userId: USER, now, roll: () => rolls.shift() });
    assert.equal(result.crime, crime.name);
    assert.equal(result.amount, crime.min);
    assert.equal(result.xp, crime.xp);
    assert.equal(result.caught, false);
    assert.ok(crime.caught > 0 && crime.caught < 1);
    assert.equal(commitCrime({ guildId: GUILD, userId: USER, now, roll: () => { throw Error('não deve sortear'); } }).retryAt, now + CRIME_COOLDOWN_MS);
  }
  assert.equal(economy.getTransactions(GUILD, USER).filter((row) => row.type === 'crime_reward').length, CRIMES.length);
  assert.equal(getUserState(GUILD, USER).totalXp, CRIMES.reduce((sum, crime) => sum + crime.xp, 0));
});

test('prisão cobra parte do saldo sem negativar, não dá XP e respeita cooldown', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount: 1000, source: 'test' });
  const rolls = [CRIMES.length - 1, 0];
  const caught = commitCrime({ guildId: GUILD, userId: USER, now: 1000, roll: () => rolls.shift() });
  assert.equal(caught.amount, -350);
  assert.equal(caught.balance, 650);
  assert.equal(caught.xp, 0);
  assert.equal(economy.getTransactions(GUILD, USER)[0].type, 'crime_fine');
  assert.equal(getUserState(GUILD, USER).totalXp, 0);
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 0, source: 'test' });
  const again = commitCrime({ guildId: GUILD, userId: USER, now: 1000 + CRIME_COOLDOWN_MS, roll: () => 0 });
  assert.equal(again.amount, 0);
  assert.equal(again.balance, 0);
});

test('economia e níveis desativados impedem ganhos indevidos', () => {
  cleanup();
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ enabled: false }));
  assert.throws(() => commitCrime({ guildId: GUILD, userId: USER }), /desativada/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM economy_cooldowns WHERE guild_id = ?').get(GUILD).total, 0);
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ enabled: true }));
  setGuildConfig(GUILD, 'levels_config', JSON.stringify({ enabled: false }));
  const result = commitCrime({ guildId: GUILD, userId: USER, now: 1000, roll: (min, max) => max - 1 });
  assert.ok(result.amount > 0);
  assert.equal(result.xp, 0);
  assert.equal(getUserState(GUILD, USER).totalXp, 0);
});

test('comando apresenta emojis globais e não paga de novo no cooldown', async () => {
  cleanup();
  setGuildConfig(GUILD, 'levels_config', JSON.stringify({ enabled: true }));
  setGuildEmoji(GUILD, 'eco_crime', '🧭');
  setGuildEmoji(GUILD, 'eco_police', '🛡️');
  try {
    const success = interaction();
    await command.execute(success);
    assert.match(success.calls[0].embeds[0].toJSON().title, /🧭|🛡️/);
    const balance = economy.getBalance(GUILD, USER);
    const waiting = interaction();
    await command.execute(waiting);
    assert.match(waiting.calls[0].embeds[0].toJSON().description, /Tente novamente/);
    assert.equal(economy.getBalance(GUILD, USER), balance);
    db.prepare('DELETE FROM economy_cooldowns WHERE guild_id = ?').run(GUILD);
    const caught = interaction();
    await command.execute(caught);
    assert.match(caught.calls[0].embeds[0].toJSON().title, /🧭|🛡️/);
  } finally {
    resetGuildEmojis();
  }
});
