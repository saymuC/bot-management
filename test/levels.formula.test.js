/**
 * Testes da progressão de XP.
 *
 * A fórmula é a peça mais barata de testar e a mais caro de errar: ela decide o
 * nível de todo mundo, e um erro de um XP na fronteira aparece como "subi e
 * desci de nível" para o usuário. Por isso os casos concentram-se nos limites
 * exatos e nas duas otimizações (soma fechada e busca binária), que são o único
 * lugar onde a implementação pode divergir da regra.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_LEVEL,
  MAX_TOTAL_XP,
  xpRequiredForNextLevel,
  totalXpForLevel,
  calculateLevelFromXp,
  xpProgress,
  clampXp,
  clampLevel,
  crossedLevels,
} = require('../utils/levels/formula');

test('xpRequiredForNextLevel segue 5N² + 50N + 100', () => {
  assert.equal(xpRequiredForNextLevel(0), 100);
  assert.equal(xpRequiredForNextLevel(1), 155);
  assert.equal(xpRequiredForNextLevel(10), 1100);
});

test('totalXpForLevel é a soma acumulada dos requisitos anteriores', () => {
  assert.equal(totalXpForLevel(0), 0);
  assert.equal(totalXpForLevel(1), 100);
  assert.equal(totalXpForLevel(2), 255);

  // A soma fechada tem de bater com o laço incremental em toda a faixa útil: é
  // exatamente aqui que um erro de índice na fórmula fechada se esconderia.
  let running = 0;
  for (let level = 0; level < 200; level += 1) {
    assert.equal(totalXpForLevel(level), running, `nível ${level}`);
    running += xpRequiredForNextLevel(level);
  }
});

test('calculateLevelFromXp acerta os limiares exatos e as vizinhanças', () => {
  assert.equal(calculateLevelFromXp(0), 0);
  assert.equal(calculateLevelFromXp(99), 0);
  assert.equal(calculateLevelFromXp(100), 1);
  assert.equal(calculateLevelFromXp(101), 1);
  assert.equal(calculateLevelFromXp(254), 1);
  assert.equal(calculateLevelFromXp(255), 2);

  for (let level = 1; level < 150; level += 1) {
    const threshold = totalXpForLevel(level);
    assert.equal(calculateLevelFromXp(threshold - 1), level - 1, `um XP antes do ${level}`);
    assert.equal(calculateLevelFromXp(threshold), level, `no limiar do ${level}`);
  }
});

test('calculateLevelFromXp equivale à subida nível por nível', () => {
  // A busca binária é uma otimização; a definição é a subida linear. Se as duas
  // divergirem em qualquer ponto, é a otimização que está errada.
  const linear = (totalXp) => {
    let level = 0;
    while (level < MAX_LEVEL && totalXpForLevel(level + 1) <= totalXp) level += 1;
    return level;
  };

  for (const xp of [0, 1, 99, 100, 255, 1000, 12_345, 500_000, 10_000_000]) {
    assert.equal(calculateLevelFromXp(xp), linear(xp), `xp ${xp}`);
  }
});

test('XP negativo, NaN e indefinido caem no nível 0', () => {
  assert.equal(calculateLevelFromXp(-1), 0);
  assert.equal(calculateLevelFromXp(-999_999), 0);
  assert.equal(calculateLevelFromXp(Number.NaN), 0);
  assert.equal(calculateLevelFromXp(undefined), 0);
  assert.equal(calculateLevelFromXp('abc'), 0);
});

test('o teto de nível não é ultrapassado e MAX_TOTAL_XP é seguro', () => {
  assert.equal(calculateLevelFromXp(MAX_TOTAL_XP), MAX_LEVEL);
  assert.equal(calculateLevelFromXp(MAX_TOTAL_XP + 1_000_000), MAX_LEVEL);
  assert.ok(Number.isSafeInteger(MAX_TOTAL_XP));
  assert.equal(totalXpForLevel(MAX_LEVEL + 50), MAX_TOTAL_XP);
});

test('xpProgress reporta o progresso dentro do nível', () => {
  const start = xpProgress(100);
  assert.equal(start.level, 1);
  assert.equal(start.xpIntoLevel, 0);
  assert.equal(start.xpForNextLevel, 155);
  assert.equal(start.percent, 0);

  const middle = xpProgress(100 + 77);
  assert.equal(middle.level, 1);
  assert.equal(middle.xpIntoLevel, 77);
  assert.ok(middle.percent > 0.49 && middle.percent < 0.5);
});

test('no nível máximo a barra fica cheia em vez de dividir por zero', () => {
  const top = xpProgress(MAX_TOTAL_XP);
  assert.equal(top.level, MAX_LEVEL);
  assert.equal(top.xpForNextLevel, 0);
  assert.equal(top.percent, 1);
});

test('clampXp e clampLevel prendem a entrada administrativa na faixa válida', () => {
  assert.equal(clampXp(-50), 0);
  assert.equal(clampXp(12.9), 12);
  assert.equal(clampXp(MAX_TOTAL_XP * 2), MAX_TOTAL_XP);
  assert.equal(clampLevel(-3), 0);
  assert.equal(clampLevel(MAX_LEVEL + 1), MAX_LEVEL);
});

test('crossedLevels lista os níveis na ordem em que foram cruzados', () => {
  assert.deepEqual(crossedLevels(4, 7), [5, 6, 7]);
  assert.deepEqual(crossedLevels(7, 4), [6, 5, 4]);
  assert.deepEqual(crossedLevels(3, 3), []);
  assert.deepEqual(crossedLevels(0, 1), [1]);
});
