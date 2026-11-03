const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { db, setGuildConfig } = require('../database/db');
const { changeBalance } = require('../utils/economy/service');
const mines = require('../utils/economy/mines/service');
const { BOARD_SIZE, generateBoard, survivalProbability, multiplier, payout } = require('../utils/economy/mines/engine');
const { getEconomyConfig, saveEconomyConfig, MAX_BALANCE } = require('../config/economy');
const { renderGame, settingsPanel, minesConfigPanel, routeMinesConfig } = require('../handlers/minesHandler');
const { REGISTRY } = require('../utils/emojis');
const execFileAsync = promisify(execFile);

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
  assert.equal(require('../utils/economy/mines/engine').safePickCount([0, 1, 2], [3, 0]), 1);
  assert.equal(new Set(generateBoard(20, 8)).size, 8);
  assert.throws(() => generateBoard(20, 20), RangeError);
});

test('derrota mostra o multiplicador correspondente apenas às casas seguras', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 3, now: now + 1 });
  const lost = mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 0, now: now + 2 });
  const fields = renderGame({ id: GUILD, name: 'Mines test' }, lost).embeds[0].toJSON().fields;
  assert.equal(fields.find((field) => field.name === 'Multiplicador').value, `${multiplier(3, 1).toFixed(2)}x`);
  assert.equal(fields.find((field) => field.name === 'Ganho potencial').value, `${payout(100, 3, 1)} moedas`);
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

test('processos concorrentes não iniciam duas partidas e reserva protege o teto da carteira', async () => {
  cleanup();
  setGuildConfig(GUILD, 'economy_config', JSON.stringify({ mines: { maxBet: 100, maxMines: 8 } }));
  assert.equal(getEconomyConfig(GUILD).mines.maxBet, 100);
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const servicePath = path.join(__dirname, '..', 'utils', 'economy', 'mines', 'service.js');
  const childScript = `setTimeout(() => { const { createGame } = require(${JSON.stringify(servicePath)}); try { createGame({ guildId: ${JSON.stringify(GUILD)}, userId: ${JSON.stringify(USER)}, bet: 100, mineCount: 8 }); console.log('CREATED'); } catch { console.log('REJECTED'); } require(${JSON.stringify(path.join(__dirname, '..', 'database', 'db.js'))}).db.close(); }, 40);`;
  const runChild = () => execFileAsync(process.execPath, ['-e', childScript], { env: process.env, timeout: 10_000 });
  const results = await Promise.all([runChild(), runChild()]);
  const outcomes = results.map(({ stdout }) => stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(outcomes.sort(), ['CREATED', 'REJECTED']);
  assert.equal(mines.getBalance(GUILD, USER), 900);
  assert.throws(() => changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: MAX_BALANCE, source: 'test' }), /limite excedido/);
  assert.throws(() => saveEconomyConfig(GUILD, { mines: { maxMines: 0 } }), /Configuração de Mines/);
});

test('a partida congela timeout e configurações subsequentes não alteram sua validade', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  saveEconomyConfig(GUILD, { mines: { timeoutSeconds: 60 } });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  assert.equal(game.timeout_seconds, 60);
  saveEconomyConfig(GUILD, { mines: { timeoutSeconds: 600 } });
  const revealed = mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 3, now: now + 10 });
  assert.equal(revealed.expires_at, now + 60_010);
  assert.equal(db.prepare('SELECT timeout_seconds FROM economy_mines_games WHERE id = ?').get(game.id).timeout_seconds, 60);
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
  const interaction = { guild: { id: GUILD }, user: { id: 'intruder' }, customId: `mines_reveal_${game.id}_4_0`,
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

test('painel antigo reconcilia o estado atual em uma única chamada e não repete a jogada', async () => {
  cleanup();
  const current = Date.now();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now: current,
    randomBoard: () => [0, 1, 2] });
  mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 3, revision: 0, now: current + 1 });
  let updateCalls = 0;
  let updated;
  const interaction = { guild: { id: GUILD, name: 'Mines test' }, user: { id: USER }, webhook: {}, message: { id: 'panel-current' }, customId: `mines_reveal_${game.id}_4_0`,
    isButton: () => true, isModalSubmit: () => false, deferred: false, replied: false,
    update: async (payload) => { updateCalls += 1; updated = payload; },
    deferUpdate: async () => assert.fail('A interação deve ser atualizada com uma única chamada REST.'),
    followUp: async (payload) => { updated = payload; } };
  await require('../handlers/minesHandler').routeMinesInteraction(interaction);
  assert.equal(updateCalls, 1);
  assert.deepEqual(mines.getActiveGame(GUILD, USER).revealed, [3]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM economy_mines_moves WHERE game_id = ?").get(game.id).n, 1);
  assert.ok(updated.components[0].components[3].disabled);
});

test('sweeper expira e atualiza painel existente sem depender da edição para reembolsar', async () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  saveEconomyConfig(GUILD, { mines: { timeoutSeconds: 60 } });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  mines.attachMessage(game.id, 'channel-id', 'message-id');
  let edited;
  const guild = { id: GUILD, name: 'Mines test' };
  const message = { guild, edit: async (payload) => { edited = payload; } };
  const client = { channels: { fetch: async () => ({ isTextBased: () => true,
    messages: { fetch: async () => message } }) } };
  const count = await require('../handlers/minesHandler').sweepMines(client, now + 60_001);
  assert.equal(count, 1);
  assert.match(edited.embeds[0].toJSON().description, /devolvida/);
  assert.equal(mines.getBalance(GUILD, USER), 1000);
});

test('falha ao registrar payout faz rollback da partida e do saldo', () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 3, now: now + 1 });
  db.exec(`CREATE TRIGGER mines_payout_fail BEFORE INSERT ON economy_transactions
    WHEN NEW.type = 'mines_payout' BEGIN SELECT RAISE(ABORT, 'simulated payout failure'); END`);
  try {
    assert.throws(() => mines.cashOut({ guildId: GUILD, userId: USER, gameId: game.id, now: now + 2 }), /simulated payout failure/);
    assert.equal(mines.getActiveGame(GUILD, USER).id, game.id);
    assert.equal(mines.getBalance(GUILD, USER), 900);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM economy_transactions WHERE type = 'mines_payout'").get().n, 0);
  } finally {
    db.exec('DROP TRIGGER mines_payout_fail');
  }
  assert.equal(mines.cashOut({ guildId: GUILD, userId: USER, gameId: game.id, now: now + 3 }).status, 'won');
});

test('saque e expiração concorrentes resultam em um único encerramento e um único crédito', async () => {
  cleanup();
  changeBalance({ guildId: GUILD, userId: USER, operation: 'set', amount: 1000, source: 'test' });
  saveEconomyConfig(GUILD, { mines: { timeoutSeconds: 60 } });
  const game = mines.createGame({ guildId: GUILD, userId: USER, bet: 100, mineCount: 3, now,
    randomBoard: () => [0, 1, 2] });
  mines.revealCell({ guildId: GUILD, userId: USER, gameId: game.id, position: 3, now: now + 1 });
  const deadline = now + 60_000;
  const servicePath = path.join(__dirname, '..', 'utils', 'economy', 'mines', 'service.js');
  const databasePath = path.join(__dirname, '..', 'database', 'db.js');
  const scripts = [
    `setTimeout(() => { const s = require(${JSON.stringify(servicePath)}); try { console.log(s.cashOut({ guildId: ${JSON.stringify(GUILD)}, userId: ${JSON.stringify(USER)}, gameId: ${game.id}, now: ${deadline - 1} }).status); } catch { console.log('ERROR'); } require(${JSON.stringify(databasePath)}).db.close(); }, 40);`,
    `setTimeout(() => { const s = require(${JSON.stringify(servicePath)}); try { console.log(s.expireDueGames(${deadline}).length); } catch { console.log('ERROR'); } require(${JSON.stringify(databasePath)}).db.close(); }, 40);`,
  ];
  await Promise.all(scripts.map((script) => execFileAsync(process.execPath, ['-e', script], { env: process.env, timeout: 10_000 })));
  const terminal = db.prepare('SELECT status FROM economy_mines_games WHERE id = ?').get(game.id).status;
  assert.ok(['won', 'expired'].includes(terminal));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM economy_transactions WHERE operation_key IN (?, ?)")
    .get(`mines:${game.id}:mines_payout`, `mines:${game.id}:mines_refund`).n, 1);
  assert.ok([1000, 1014].includes(mines.getBalance(GUILD, USER)));
});
