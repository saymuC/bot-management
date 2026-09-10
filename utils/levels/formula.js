// @ts-check
/**
 * Progressão de XP.
 *
 * A regra é uma só: para sair do nível `N` são necessários `5N² + 50N + 100` XP.
 * Tudo o mais deriva daí — e é por isso que o banco guarda **só** o XP total. Um
 * nível guardado numa coluna pode divergir do XP (basta uma escrita falhar no
 * meio); um nível calculado não pode.
 *
 * Duas escolhas de desempenho importam aqui, porque isto roda em toda mensagem
 * elegível do servidor:
 *
 *   - `totalXpForLevel` usa a soma fechada da progressão, não um laço;
 *   - `calculateLevelFromXp` usa busca binária, não uma subida nível por nível
 *     (que no teto custaria mil iterações por mensagem).
 */

const { MAX_LEVEL } = require('../../config/levels');

/** Inteiro seguro e não negativo, ou 0. Porta de entrada de tudo neste arquivo. */
function toSafeCount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * XP necessário para sair do nível informado.
 * @param {number} level
 * @returns {number}
 */
function xpRequiredForNextLevel(level) {
  const n = Math.min(MAX_LEVEL, toSafeCount(level));
  return 5 * n * n + 50 * n + 100;
}

/**
 * XP total mínimo para **estar** no nível informado.
 *
 * Soma fechada de `xpRequiredForNextLevel(0..level-1)`:
 *   5·Σk² + 50·Σk + 100·n,  com Σ de k = 0 até n-1.
 *
 * @param {number} level
 * @returns {number}
 */
function totalXpForLevel(level) {
  const n = Math.min(MAX_LEVEL, toSafeCount(level));

  return (5 * (n - 1) * n * (2 * n - 1)) / 6 + 25 * n * (n - 1) + 100 * n;
}

/** Teto de XP: mais que isto não faria o nível subir, então nada é guardado além. */
const MAX_TOTAL_XP = totalXpForLevel(MAX_LEVEL);

/**
 * Nível correspondente a um XP total: o maior `L` com `totalXpForLevel(L) <= xp`.
 * @param {number} totalXp
 * @returns {number}
 */
function calculateLevelFromXp(totalXp) {
  const xp = Math.min(MAX_TOTAL_XP, toSafeCount(totalXp));

  let low = 0;
  let high = MAX_LEVEL;

  while (low < high) {
    // Teto no meio: com `low = high - 1` o piso não avançaria e o laço travaria.
    const mid = Math.ceil((low + high) / 2);
    if (totalXpForLevel(mid) <= xp) low = mid;
    else high = mid - 1;
  }

  return low;
}

/**
 * Progresso dentro do nível atual.
 *
 * No teto (`MAX_LEVEL`) não há próximo nível: `xpForNextLevel` é 0 e o percentual
 * é 1, para a barra do `/rank` aparecer cheia em vez de dividir por zero.
 *
 * @param {number} totalXp
 * @returns {import('./types').XpProgress}
 */
function xpProgress(totalXp) {
  const xp = Math.min(MAX_TOTAL_XP, toSafeCount(totalXp));
  const level = calculateLevelFromXp(xp);
  const xpIntoLevel = xp - totalXpForLevel(level);
  const xpForNextLevel = level >= MAX_LEVEL ? 0 : xpRequiredForNextLevel(level);

  return {
    level,
    totalXp: xp,
    xpIntoLevel,
    xpForNextLevel,
    percent: xpForNextLevel ? Math.min(1, xpIntoLevel / xpForNextLevel) : 1,
  };
}

/** XP administrativo válido: inteiro, nunca negativo, nunca acima do teto. */
const clampXp = (raw) => Math.min(MAX_TOTAL_XP, toSafeCount(raw));

/** Nível administrativo válido: inteiro entre 0 e MAX_LEVEL. */
const clampLevel = (raw) => Math.min(MAX_LEVEL, toSafeCount(raw));

/**
 * Níveis atravessados entre dois níveis, na ordem em que foram cruzados.
 *
 * Subida `4 → 7` devolve `[5, 6, 7]`; queda `7 → 4` devolve `[6, 5, 4]`. As
 * recompensas não usam esta lista (elas reconciliam pelo nível final), mas o log
 * administrativo e o anúncio precisam saber o que aconteceu no meio.
 *
 * @param {number} previousLevel
 * @param {number} newLevel
 * @returns {number[]}
 */
function crossedLevels(previousLevel, newLevel) {
  const from = clampLevel(previousLevel);
  const to = clampLevel(newLevel);
  if (from === to) return [];

  const step = to > from ? 1 : -1;
  const levels = [];
  for (let level = from + step; level !== to + step; level += step) levels.push(level);
  return levels;
}

module.exports = {
  MAX_LEVEL,
  MAX_TOTAL_XP,
  xpRequiredForNextLevel,
  totalXpForLevel,
  calculateLevelFromXp,
  xpProgress,
  clampXp,
  clampLevel,
  crossedLevels,
};
