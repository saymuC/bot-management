const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../database/db');
const { changeBalance, purchaseItem } = require('../utils/economy/service');
const { getTransactions } = require('../utils/economy/repository');
const command = require('../commands/economy/extrato');

const GUILD = 'test-economy-statement';
const USER = 'test-user-statement';
test.after(() => {
  for (const table of ['economy_inventory', 'economy_transactions', 'economy_accounts']) {
    db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(GUILD);
  }
});

function interaction(userId = USER) {
  const calls = [];
  return {
    guild: { id: GUILD }, guildId: GUILD, user: { id: userId }, deferred: true, calls,
    editReply: async (payload) => { calls.push(payload); },
  };
}

test('extrato vazio não cria conta', async () => {
  const i = interaction();
  await command.execute(i);
  assert.match(i.calls[0].embeds[0].toJSON().description, /Nenhuma movimentação/);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM economy_accounts WHERE guild_id = ?').get(GUILD).total, 0);
});

test('extrato é privado, limitado e acompanha compra e saldo real', async () => {
  changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount: 1000, source: 'test' });
  purchaseItem({ guildId: GUILD, userId: USER, itemId: 'cafe' });
  for (let n = 0; n < 12; n += 1) {
    changeBalance({ guildId: GUILD, userId: USER, operation: 'add', amount: 1, source: 'test' });
  }
  const i = interaction();
  await command.execute(i);
  const embed = i.calls[0].embeds[0].toJSON();
  assert.equal(embed.fields.length, 10);
  assert.equal(getTransactions(GUILD, USER, 10).length, 10);
  assert.match(embed.footer.text, /862/);
  const other = interaction('outro');
  await command.execute(other);
  assert.match(other.calls[0].embeds[0].toJSON().description, /Nenhuma movimentação/);
});
