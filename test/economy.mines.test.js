const test = require('node:test');
const assert = require('node:assert/strict');
const { db, setGuildConfig } = require('../database/db');
const { changeBalance } = require('../utils/economy/service');
const mines = require('../utils/economy/mines/service');
const { BOARD_SIZE, generateBoard, survivalProbability, multiplier, payout } = require('../utils/economy/mines/engine');
const { getEconomyConfig, saveEconomyConfig, MAX_BALANCE } = require('../config/economy');
const { renderGame, settingsPanel, minesConfigPanel, routeMinesConfig } = require('../handlers/minesHandler');
const { REGISTRY } = require('../utils/emojis');

const GUILD = 'test-mines';
const OTHER = 'test-mines-other';
const USER = 'mines-user';
const now = 1_000_000;

function cleanup() {
  for (const table of ['economy_mines_moves', 'economy_mines_games', 'economy_mines_preferences', 'economy_transactions', 'economy_accounts']) {
    db.prepare(`DELETE FROM ${table} WHERE ${table === 'economy_mines_moves' ? 'game_id IN (SELECT id FROM economy_mines_games WHERE guild_id IN (?, ?))' : 'guild_id IN (?, ?)'}`).run(GUILD, OTHER);
  }
  db.prepare('DELETE FROM guild_config WHERE guild_id IN (?, ?)').run(GUILD, OTHER);
}

test.before(cleanup);
test.after(cleanup);

test('engine gera minas únicas, calcula probabilidades e arredonda apenas pagamento', () => {
  assert.equal(BOARD_SIZE, 20);
  assert.deepEqual(generateBoard(5, 2, (min) => min), [0, 1]);
  assert.equal(survivalProbability(3, 1), 0.85);
  assert.ok(Math.abs(multiplier(3, 1) - 0.97 / 0.85) < 1e-12);
  assert.equal(payout(1000, 3, 1), 1141);
  assert.equal(new Set(generateBoard(20, 8)).size, 8);
  assert.throws(() => generateBoard(20, 20), RangeError);
});

test('aposta e saque são atômicos, idempotentes e registrados no extrato', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 5000, source: 'test' });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 1, now,
    randomBoard: () => [19] });
  assert.equal(mines.getBalance(GUILD, USER), 4900);
  assert.equal(game.board, undefined);
  assert.equal(game.reserved_payout, 1940);
  assert.equal(mines.getPreferences(GUILD, USER).bet, 100);
  const afterPick = mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 0, now: now + 1 });
  assert.deepEqual(afterPick.revealed, [0]);
  assert.equal(afterPick.board, undefined);
  const paid = mines.cashOut({ guildId: GUILD, userId: USER, gameId: game.id, now: now + 2 });
  assert.equal(paid.status, 'won');
  assert.deepEqual(paid.board, [19]);
  assert.equal(mines.getBalance(GUILD, USER), 5002);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM economy_transactions WHERE operation_key = ?').get(`mines:${game.id}:mines_payout`).n, 1);
  assert.equal(mines.cashOut({ guildId: GUILD, userId: USER, gameId: game.id }).payout, 102);
  assert.equal(mines.getBalance(GUILD, USER), 5002);
});

test('mina, expiração, preferência e isolamento por servidor mantêm saldo consistente', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const lostGame = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 1, now,
    randomBoard: () => [0] });
  assert.equal(mines.revealCell({ guildId: GUILD, userId: USER, gameId: lostGame.id, position: 0, now: now + 1 }).status, 'lost');
  assert.equal(mines.getBalance(GUILD, USER), 900);
  const expiring = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 1, now: now + 2,
    randomBoard: () => [19] });
  assert.equal(mines.expireDueGames(now + 300_003).length, 1);
  assert.equal(mines.getBalance(GUILD, USER), 900);
  assert.equal(mines.getBalance(OTHER, USER), 0);
  assert.equal(db.prepare('SELECT status FROM economy_mines_games WHERE id = ?').get(expiring.id).status, 'expired');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM economy_transactions WHERE type = 'mines_refund'").get().n, 1);
});

test('concorrência impede duas partidas ativas e a reserva protege o teto da carteira', async () => {
  cleanup();
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ mines: { maxBet: 100, maxMines: 8 } }));
  assert.equal(getEconomyConfig(GUILD).mines.maxBet, 100);
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const attempts = await Promise.allSettled([
    Promise.resolve().then(() => mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 8, now })),
    Promise.resolve().then(() => mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 8, now })),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(mines.getBalance(GUILD, USER), 900);
  assert.throws(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: MAX_BALANCE, source: 'test' }), /limite excedido/);
  assert.throws(() => saveEconomyConfig(GUILD, { mines: { maxMines: 0 } }), /Configuração de Mines/);
});

test('painel e tabuleiro cabem nos limites Discord e ocultam minas durante jogo ativo', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  for (const key of ['eco_mines', 'eco_mines_safe', 'eco_mines_cashout']) assert.ok(REGISTRY[key]);
  const guild = { id: GUILD, name: 'Mines test' };
  const prefs = settingsPanel(guild, USER);
  assert.equal(prefs.components[0].components.length, 2);
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [2, 10, 19] });
  const payload = renderGame(guild, game);
  assert.equal(payload.components.length, 5);
  assert.deepEqual(payload.components.slice(0, 4).map((row) => row.components.length), [5, 5, 5, 5]);
  assert.ok(!payload.components.some((row) => row.components.some((button) => button.emoji?.name === '💣')));
  assert.ok(!JSON.stringify(payload).includes('2,10,19'));
  assert.equal(minesConfigPanel(guild).components.length, 1);
});

test('controle administrativo do Mines respeita permissões e reembolsa ao desativar', async () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  const guild = { id: GUILD, name: 'Mines test' };
  let updated;
  await routeMinesConfig({ guild, guildId: GUILD, user: { id: 'admin' }, memberPermissions: { has: () => true },
    customId: 'eco_cfg_mines_toggle', isButton: () => true,
    update: async (payload) => { updated = payload; } });
  assert.match(updated.embeds[0].toJSON().description, /Desativada/);
  assert.equal(mines.getBalance(GUILD, USER), 1000);
  assert.equal(db.prepare('SELECT status FROM economy_mines_games WHERE id = ?').get(game.id).status, 'refunded');
  assert.equal(getEconomyConfig(GUILD).mines.enabled, false);
});

test('jogada de outro usuário recebe recusa efêmera sem alterar o painel ou saldo', async () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  let warning;
  const interaction = { guild: { id: GUILD }, user: { id: 'intruder' }, customId: `mines_reveal_${game.id}_4`,
    isButton: () => true, isModalSubmit: () => false, deferred: false, replied: false,
    deferUpdate: async () => { interaction.deferred = true; },
    editReply: async () => assert.fail('Outro jogador não pode editar a partida.'),
    followUp: async (payload) => { warning = payload; } };
  await require('../handlers/minesHandler').routeMinesInteraction(interaction);
  assert.equal(warning.flags, 64);
  assert.match(warning.embeds[0].toJSON().description, /não pertence a você/i);
  assert.equal(mines.getBalance(GUILD, USER), 900);
  assert.deepEqual(mines.getActiveGame(GUILD, USER).revealed, []);
});
