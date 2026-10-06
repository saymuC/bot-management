const test = require('node:test');
const assert = require('node:assert/strict');
const { db, setGuildConfig } = require('../database/db');
const { changeBalance } = require('../utils/economy/service');
const { buildRanking, handleRankingPagination } = require('../handlers/economyLeaderboardHandler');
const { checkCanvasFonts } = require('../utils/canvasFonts');

const GUILD = 'test-economy-commands';
const USER_A = '111111111111111111';
const USER_B = '222222222222222222';
const guild = { id: GUILD, name: 'Teste' };
guild.members = { cache: new Map(), fetch: async (id) => ({ displayName: `Membro ${id}`, user: { username: id, displayAvatarURL: () => null } }) };
guild.client = { users: { cache: new Map(), fetch: async () => null } };

function cleanup() {
  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(GUILD);
  for (const table of ['economy_cooldowns', 'economy_transactions', 'economy_accounts']) {
    db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(GUILD);
  }
}
test.before(cleanup);
test.after(cleanup);

function commandInteraction() {
  const calls = [];
  return { guild, guildId: GUILD, user: { id: USER_A }, deferred: true,
    options: { getString: () => null }, calls,
    editReply: async (payload) => { calls.push(payload); } };
}

test('daily, trabalhar e loja respondem economia desligada sem gravar', async () => {
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ enabled: false }));
  for (const name of ['daily', 'trabalhar', 'loja']) {
    const interaction = commandInteraction();
    await require(`../commands/economy/${name}`).execute(interaction);
    assert.match(interaction.calls[0].embeds[0].toJSON().description, /economia está desativada/i, name);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM economy_accounts WHERE guild_id = ?').get(GUILD).total, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM economy_cooldowns WHERE guild_id = ?').get(GUILD).total, 0);
  const purchase = commandInteraction();
  purchase.options.getString = () => 'cafe';
  await require('../commands/economy/loja').execute(purchase);
  assert.match(purchase.calls[0].embeds[0].toJSON().description, /economia está desativada/i);
});

test('paginação usa o usuário que clicou e gera IDs sem o autor original', async () => {
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ enabled: true }));
  changeBalance({ guildId: GUILD, userId: USER_A, operation: 'add', amount: 100, source: 'test' });
  changeBalance({ guildId: GUILD, userId: USER_B, operation: 'add', amount: 200, source: 'test' });
  const initial = await buildRanking(guild, 1, USER_A);
  if (checkCanvasFonts().ok) assert.equal(initial.files.length, 1);
  else assert.match(initial.embeds[0].toJSON().footer.text, /Sua posição: #2/);
  assert.equal(initial.components[0].components[1].custom_id, 'ecotop_2');
  let updated;
  await handleRankingPagination({ guild, user: { id: USER_B },
    deferUpdate: async () => {}, editReply: async (payload) => { updated = payload; } }, '2');
  if (checkCanvasFonts().ok) assert.equal(updated.files.length, 1);
  else assert.match(updated.embeds[0].toJSON().footer.text, /Sua posição: #1/);
  assert.equal(updated.components[0].components[1].custom_id, 'ecotop_2');
});
