// @ts-check
const { randomInt } = require('node:crypto');

const BOARD_SIZE = 20;
const MIN_BOARD_SIZE = 4;

function validateGame(mineCount, houseEdgeBps = 300, size = BOARD_SIZE) {
  if (!Number.isSafeInteger(size) || size < MIN_BOARD_SIZE || size > BOARD_SIZE ||
      !Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= size ||
      !Number.isSafeInteger(houseEdgeBps) || houseEdgeBps < 0 || houseEdgeBps >= 10_000) {
    throw new RangeError('Configuração de Mines inválida.');
  }
}

/** @param {number} size @param {number} mineCount @param {(min: number, max: number) => number} draw */
function generateBoard(size = BOARD_SIZE, mineCount = 3, draw = randomInt) {
  if (!Number.isSafeInteger(size) || size < MIN_BOARD_SIZE || size > BOARD_SIZE || !Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= size) {
    throw new RangeError('Configuração do tabuleiro inválida.');
  }
  const cells = Array.from({ length: size }, (_, index) => index);
  for (let i = 0; i < mineCount; i += 1) {
    const j = draw(i, size);
    if (!Number.isSafeInteger(j) || j < i || j >= size) throw new RangeError('Sorteio de posição inválido.');
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, mineCount).sort((a, b) => a - b);
}

function survivalProbability(mineCount, safePicks, size = BOARD_SIZE) {
  if (!Number.isSafeInteger(size) || size < MIN_BOARD_SIZE || size > BOARD_SIZE || !Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= size ||
      !Number.isSafeInteger(safePicks) || safePicks < 0 || safePicks > size - mineCount) {
    throw new RangeError('Quantidade de casas inválida.');
  }
  let probability = 1;
  for (let i = 0; i < safePicks; i += 1) probability *= (size - mineCount - i) / (size - i);
  return probability;
}

function multiplier(mineCount, safePicks, houseEdgeBps = 300, size = BOARD_SIZE) {
  validateGame(mineCount, houseEdgeBps, size);
  if (safePicks === 0) return 1;
  return (10_000 - houseEdgeBps) / 10_000 / survivalProbability(mineCount, safePicks, size);
}

function payout(bet, mineCount, safePicks, houseEdgeBps = 300, size = BOARD_SIZE) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new RangeError('Aposta inválida.');
  const amount = Math.floor(bet * multiplier(mineCount, safePicks, houseEdgeBps, size));
  if (!Number.isSafeInteger(amount)) throw new RangeError('Pagamento excede o limite seguro.');
  return amount;
}

function safeIncrement(bet, mineCount, safePicks, houseEdgeBps = 300, size = BOARD_SIZE) {
  if (!Number.isSafeInteger(safePicks) || safePicks < 1) throw new RangeError('Quantidade de casas seguras inválida.');
  const previous = safePicks === 1 ? bet : payout(bet, mineCount, safePicks - 1, houseEdgeBps, size);
  return payout(bet, mineCount, safePicks, houseEdgeBps, size) - previous;
}

function safeTileIncrement(bet, mineCount, safeOrdinal, houseEdgeBps = 300, size = BOARD_SIZE) {
  if (!Number.isSafeInteger(safeOrdinal) || safeOrdinal < 1) throw new RangeError('Número de acerto inválido.');
  return safeIncrement(bet, mineCount, safeOrdinal, houseEdgeBps, size);
}

function safePickCount(board, revealed) {
  const mines = new Set(board);
  return revealed.reduce((count, position) => count + (mines.has(position) ? 0 : 1), 0);
}

module.exports = { BOARD_SIZE, MIN_BOARD_SIZE, generateBoard, survivalProbability, multiplier, payout, safeIncrement, safeTileIncrement, safePickCount, validateGame };
