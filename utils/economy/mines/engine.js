// @ts-check
const { randomInt } = require('node:crypto');

const BOARD_SIZE = 20;

function validateGame(mineCount, houseEdgeBps = 300) {
  if (!Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= BOARD_SIZE ||
      !Number.isSafeInteger(houseEdgeBps) || houseEdgeBps < 0 || houseEdgeBps >= 10_000) {
    throw new RangeError('Configuração de Mines inválida.');
  }
}

/** @param {number} size @param {number} mineCount @param {(min: number, max: number) => number} draw */
function generateBoard(size = BOARD_SIZE, mineCount = 3, draw = randomInt) {
  if (!Number.isSafeInteger(size) || size < 2 || !Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= size) {
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
  if (!Number.isSafeInteger(size) || size < 2 || !Number.isSafeInteger(mineCount) || mineCount < 1 || mineCount >= size ||
      !Number.isSafeInteger(safePicks) || safePicks < 0 || safePicks > size - mineCount) {
    throw new RangeError('Quantidade de casas inválida.');
  }
  let probability = 1;
  for (let i = 0; i < safePicks; i += 1) probability *= (size - mineCount - i) / (size - i);
  return probability;
}

function multiplier(mineCount, safePicks, houseEdgeBps = 300, size = BOARD_SIZE) {
  validateGame(mineCount, houseEdgeBps);
  if (safePicks === 0) return 1;
  return (10_000 - houseEdgeBps) / 10_000 / survivalProbability(mineCount, safePicks, size);
}

function payout(bet, mineCount, safePicks, houseEdgeBps = 300) {
  if (!Number.isSafeInteger(bet) || bet < 1) throw new RangeError('Aposta inválida.');
  const amount = Math.floor(bet * multiplier(mineCount, safePicks, houseEdgeBps));
  if (!Number.isSafeInteger(amount)) throw new RangeError('Pagamento excede o limite seguro.');
  return amount;
}

module.exports = { BOARD_SIZE, generateBoard, survivalProbability, multiplier, payout, validateGame };
