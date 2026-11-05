// @ts-check
const { db } = require('../../../database/db');
const { MAX_BALANCE, getEconomyConfig } = require('../../../config/economy');
const { generateBoard, BOARD_SIZE, MIN_BOARD_SIZE, payout, validateGame } = require('./engine');

const balance = db.prepare('SELECT wallet FROM economy_accounts WHERE guild_id = ? AND user_id = ?');
const active = db.prepare("SELECT * FROM economy_mines_games WHERE guild_id = ? AND user_id = ? AND status = 'active'");
const gameById = db.prepare('SELECT * FROM economy_mines_games WHERE id = ? AND guild_id = ?');
const latestGame = db.prepare('SELECT * FROM economy_mines_games WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1');
const insertBalance = db.prepare(`INSERT INTO economy_accounts (guild_id, user_id, wallet) VALUES (?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET wallet = excluded.wallet, updated_at = CURRENT_TIMESTAMP`);
const insertTransaction = db.prepare(`INSERT INTO economy_transactions
  (guild_id, user_id, type, amount, balance_before, balance_after, metadata, operation_key)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const reserved = db.prepare("SELECT COALESCE(SUM(reserved_payout), 0) AS total FROM economy_mines_games WHERE guild_id = ? AND user_id = ? AND status = 'active'");
const insertGame = db.prepare(`INSERT INTO economy_mines_games
  (guild_id, user_id, bet, board_size, mine_count, house_edge_bps, timeout_seconds, board, reserved_payout, created_at, updated_at, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const updateGame = db.prepare(`UPDATE economy_mines_games SET revealed = ?, status = ?, payout = ?, updated_at = ?,
  expires_at = ?, finished_at = ?, revision = revision + 1 WHERE id = ? AND status = 'active'`);
const insertMove = db.prepare('INSERT INTO economy_mines_moves (game_id, position, move_number, safe, created_at) VALUES (?, ?, ?, ?, ?)');
const updateMessage = db.prepare('UPDATE economy_mines_games SET channel_id = ?, message_id = ? WHERE id = ? AND status = \'active\'');
const preferences = db.prepare('SELECT bet, board_size, mine_count FROM economy_mines_preferences WHERE guild_id = ? AND user_id = ?');
const savePreferences = db.prepare(`INSERT INTO economy_mines_preferences (guild_id, user_id, bet, board_size, mine_count) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(guild_id, user_id) DO UPDATE SET bet = excluded.bet, board_size = excluded.board_size, mine_count = excluded.mine_count`);
const expiredGames = db.prepare("SELECT id, guild_id, user_id, channel_id, message_id FROM economy_mines_games WHERE status = 'active' AND expires_at <= ? ORDER BY expires_at");
const activeGames = db.prepare("SELECT id, guild_id, user_id FROM economy_mines_games WHERE status = 'active'");

function getBalance(guildId, userId) { return balance.get(guildId, userId)?.wallet ?? 0; }
function getPreferences(guildId, userId) {
  const config = getEconomyConfig(guildId).mines;
  const saved = preferences.get(guildId, userId);
  const boardSize = saved?.board_size ?? BOARD_SIZE;
  return saved && saved.bet >= config.minBet && saved.bet <= config.maxBet &&
    Number.isSafeInteger(boardSize) && boardSize >= MIN_BOARD_SIZE && boardSize <= BOARD_SIZE &&
    Number.isSafeInteger(saved.mine_count) && saved.mine_count >= 1 && saved.mine_count <= Math.min(config.maxMines, boardSize - 1)
    ? saved : { bet: config.minBet, board_size: BOARD_SIZE, mine_count: Math.min(3, config.maxMines, BOARD_SIZE - 1) };
}
function getActiveGame(guildId, userId) {
  const game = active.get(guildId, userId);
  return game ? publicGame(game) : null;
}

function getGame(guildId, userId, gameId) {
  const game = gameById.get(gameId, guildId);
  return game && game.user_id === userId ? publicGame(game, game.status !== 'active') : null;
}

function getLatestGame(guildId, userId) {
  const game = latestGame.get(guildId, userId);
  return game ? publicGame(game, game.status !== 'active') : null;
}

function getGameRevision(guildId, userId, gameId) {
  const game = gameById.get(gameId, guildId);
  return game?.user_id === userId ? game.revision : null;
}

function attachActiveMessage(guildId, userId, channelId, messageId) {
  const game = active.get(guildId, userId);
  if (game) attachMessage(game.id, channelId, messageId);
  return game?.id ?? null;
}

function setPreferences(guildId, userId, bet, boardSize, mineCount) {
  const config = getEconomyConfig(guildId);
  if (!Number.isSafeInteger(bet) || bet < config.mines.minBet || bet > config.mines.maxBet) throw new RangeError(`A aposta deve estar entre ${config.mines.minBet} e ${config.mines.maxBet}.`);
  if (!Number.isSafeInteger(boardSize) || boardSize < MIN_BOARD_SIZE || boardSize > BOARD_SIZE) throw new RangeError(`Escolha entre ${MIN_BOARD_SIZE} e ${BOARD_SIZE} casas.`);
  if (!Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount > boardSize - 1) {
    throw new RangeError(`Escolha entre 1 e ${boardSize - 1} minas para esse tabuleiro.`);
  }
  if (mineCount > config.mines.maxMines) throw new RangeError(`O limite atual é ${config.mines.maxMines} minas.`);
  const maxSafePicks = boardSize - mineCount;
  if (payout(bet, mineCount, maxSafePicks, config.mines.houseEdgeBps, boardSize) > MAX_BALANCE) {
    const requiredMines = Array.from({ length: maxSafePicks - 1 }, (_, index) => mineCount + index + 1)
      .find((count) => payout(bet, count, boardSize - count, config.mines.houseEdgeBps, boardSize) <= MAX_BALANCE);
    throw new RangeError(requiredMines
      ? `Esse pagamento excede o limite da carteira. Com ${boardSize} casas e aposta de ${bet}, use pelo menos ${requiredMines} minas.`
      : 'Esse pagamento excede o limite da carteira; reduza a aposta.');
  }
  savePreferences.run(guildId, userId, bet, boardSize, mineCount);
  return { bet, board_size: boardSize, mine_count: mineCount };
}

function publicGame(game, revealBoard = false) {
  return { ...game, board: revealBoard ? JSON.parse(game.board) : undefined, revealed: JSON.parse(game.revealed) };
}

function recordBalance(guildId, userId, amount, type, gameId, key) {
  const previous = getBalance(guildId, userId);
  const next = previous + amount;
  if (next < 0 || next > MAX_BALANCE) throw new RangeError('Saldo insuficiente ou limite de crédito excedido.');
  insertBalance.run(guildId, userId, next);
  insertTransaction.run(guildId, userId, type, amount, previous, next, JSON.stringify({ gameId }), key);
  return next;
}

/** @param {any} game @param {'won'|'lost'|'expired'|'refunded'} status @param {number} now @param {number} [payoutAmount] @param {'mines_payout'|'mines_refund'|null} [type] */
function closeGame(game, status, now, payoutAmount = 0, type = null) {
  if (updateGame.run(game.revealed, status, payoutAmount, now, game.expires_at, now, game.id).changes !== 1) return null;
  if (type) recordBalance(game.guild_id, game.user_id, payoutAmount, type, game.id, `mines:${game.id}:${type}`);
  return gameById.get(game.id, game.guild_id);
}

function createGame({ guildId, userId, bet, boardSize = BOARD_SIZE, mineCount, now = Date.now(), randomBoard = generateBoard }) {
  if (!guildId || !userId || !Number.isSafeInteger(now) || now < 0) throw new Error('Dados da partida inválidos.');
  const config = getEconomyConfig(guildId);
  if (!config.enabled || !config.mines.enabled) throw new Error('Mines está desativado neste servidor.');
  if (!Number.isSafeInteger(bet) || bet < config.mines.minBet || bet > config.mines.maxBet) throw new RangeError('Aposta fora dos limites configurados.');
  if (!Number.isSafeInteger(boardSize) || boardSize < MIN_BOARD_SIZE || boardSize > BOARD_SIZE) throw new RangeError(`Escolha entre ${MIN_BOARD_SIZE} e ${BOARD_SIZE} casas.`);
   if (!Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount > boardSize - 1) throw new RangeError('Quantidade de minas inválida para esse tabuleiro.');
  validateGame(mineCount, config.mines.houseEdgeBps, boardSize);
  const board = randomBoard(boardSize, mineCount);
  if (!Array.isArray(board) || board.length !== mineCount || new Set(board).size !== mineCount ||
      board.some((cell) => !Number.isSafeInteger(cell) || cell < 0 || cell >= boardSize)) throw new Error('Tabuleiro gerado inválido.');
  const maxSafePicks = boardSize - mineCount;
  const maxPayout = payout(bet, mineCount, maxSafePicks, config.mines.houseEdgeBps, boardSize);
  if (maxPayout > MAX_BALANCE) {
    const requiredMines = Array.from({ length: maxSafePicks - 1 }, (_, index) => mineCount + index + 1)
      .find((count) => payout(bet, count, boardSize - count, config.mines.houseEdgeBps, boardSize) <= MAX_BALANCE);
    throw new RangeError(requiredMines
      ? `Essa aposta excede o limite de pagamento. Com ${boardSize} casas, use pelo menos ${requiredMines} minas.`
      : 'Essa aposta excede o limite de pagamento; reduza a aposta.');
  }

  return db.transaction(() => {
    if (active.get(guildId, userId)) throw new Error('Você já tem uma partida ativa.');
    const previous = getBalance(guildId, userId);
    if (previous < bet) throw new RangeError('Saldo insuficiente para essa aposta.');
    const reservedTotal = reserved.get(guildId, userId).total;
    if (MAX_BALANCE - (previous - bet) - reservedTotal < maxPayout) throw new RangeError('Não há capacidade de crédito suficiente para reservar o pagamento máximo desta partida.');
    const id = insertGame.run(guildId, userId, bet, boardSize, mineCount, config.mines.houseEdgeBps, config.mines.timeoutSeconds, JSON.stringify(board), maxPayout,
      now, now, now + config.mines.timeoutSeconds * 1000).lastInsertRowid;
    insertBalance.run(guildId, userId, previous - bet);
    insertTransaction.run(guildId, userId, 'mines_bet', -bet, previous, previous - bet, JSON.stringify({ gameId: id }), `mines:${id}:bet`);
    savePreferences.run(guildId, userId, bet, boardSize, mineCount);
    return publicGame(gameById.get(id, guildId));
  }).immediate();
}

function revealCell({ guildId, userId, gameId, position, revision, now = Date.now() }) {
  if (!Number.isSafeInteger(gameId) || !Number.isSafeInteger(position) || position < 0 ||
      !Number.isSafeInteger(revision) || revision < 0) throw new Error('Jogada inválida.');
  return db.transaction(() => {
    const game = gameById.get(gameId, guildId);
    if (!game || game.user_id !== userId) throw new Error('Partida não encontrada ou não pertence a você.');
    if (position >= game.board_size) throw new Error('Casa fora do tabuleiro.');
    if (game.status !== 'active') return publicGame(game, true);
    if (now >= game.expires_at) return publicGame(closeGame(game, 'expired', now, game.bet, 'mines_refund'), true);
    if (revision !== game.revision) throw new Error('Este painel ficou desatualizado. A partida foi atualizada em outro painel.');
    const revealed = JSON.parse(game.revealed);
    if (revealed.includes(position)) throw new Error('Essa casa já foi selecionada.');
    const board = JSON.parse(game.board);
    const safe = !board.includes(position);
    insertMove.run(game.id, position, revealed.length + 1, safe ? 1 : 0, now);
    revealed.push(position);
    const next = { ...game, revealed: JSON.stringify(revealed) };
    if (!safe) {
      const result = closeGame(next, 'lost', now, 0);
      return publicGame({ ...result, board: game.board }, true);
    }
    if (revealed.length === game.board_size - game.mine_count) {
      const prize = payout(game.bet, game.mine_count, revealed.length, game.house_edge_bps, game.board_size);
      const result = closeGame(next, 'won', now, prize, 'mines_payout');
      return publicGame({ ...result, board: game.board }, true);
    }
    updateGame.run(JSON.stringify(revealed), 'active', 0, now, now + game.timeout_seconds * 1000, null, game.id);
    return publicGame(gameById.get(game.id, guildId));
  }).immediate();
}

function cashOut({ guildId, userId, gameId, revision, now = Date.now() }) {
  if (!Number.isSafeInteger(gameId) || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Revisão de painel inválida.');
  return db.transaction(() => {
    const game = gameById.get(gameId, guildId);
    if (!game || game.user_id !== userId) throw new Error('Partida não encontrada ou não pertence a você.');
    if (game.status !== 'active') return publicGame(game, true);
    if (now >= game.expires_at) return publicGame(closeGame(game, 'expired', now, game.bet, 'mines_refund'), true);
    if (revision !== game.revision) throw new Error('Este painel ficou desatualizado. A partida foi atualizada em outro painel.');
    const revealed = JSON.parse(game.revealed);
    if (revealed.length === 0) throw new Error('Revele ao menos uma casa segura antes de retirar.');
    const prize = payout(game.bet, game.mine_count, revealed.length, game.house_edge_bps, game.board_size);
    const result = closeGame(game, 'won', now, prize, 'mines_payout');
    return publicGame({ ...result, board: game.board }, true);
  }).immediate();
}

/** @param {{guildId: string, userId: string, gameId: number, now?: number, status?: 'expired'|'refunded'}} params */
function expireGame({ guildId, userId, gameId, now = Date.now(), status = 'expired' }) {
  return db.transaction(() => {
    const game = gameById.get(gameId, guildId);
    if (!game || game.user_id !== userId || game.status !== 'active') return null;
    return publicGame(closeGame(game, status, now, game.bet, 'mines_refund'), true);
  }).immediate();
}

function expireDueGames(now = Date.now()) {
  const pending = expiredGames.all(now);
  return pending.map((game) => {
    const resolved = expireGame({ guildId: game.guild_id, userId: game.user_id, gameId: game.id, now });
    return resolved ? { ...resolved, channel_id: game.channel_id, message_id: game.message_id } : null;
  }).filter(Boolean);
}

/** @param {string|undefined} guildId @param {number} [now] @param {'expired'|'refunded'} [status] */
function refundAllActive(guildId, now = Date.now(), status = 'refunded') {
  return activeGames.all().filter((game) => !guildId || game.guild_id === guildId)
    .map((game) => expireGame({ guildId: game.guild_id, userId: game.user_id, gameId: game.id, now, status })).filter(Boolean);
}

function attachMessage(gameId, channelId, messageId) { updateMessage.run(channelId, messageId, gameId); }

module.exports = { getBalance, getPreferences, getActiveGame, getGame, getLatestGame, getGameRevision, attachActiveMessage, setPreferences, createGame, revealCell, cashOut, expireGame, expireDueGames, refundAllActive, attachMessage };
