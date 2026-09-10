// @ts-check
/**
 * Formatação e paginação do ranking. Sem Discord e sem banco: só aritmética de
 * página e montagem de texto, para o `/top` e o `/rank` não repetirem as mesmas
 * contas de offset e as mesmas barras de progresso.
 */

/** Posições por página. Dez cabe no embed com folga, inclusive com nomes longos. */
const PAGE_SIZE = 10;

/** Largura da barra textual de progresso. */
const BAR_WIDTH = 12;

/** Medalha das três primeiras posições; o resto vai numerado. */
const MEDALS = Object.freeze(['🥇', '🥈', '🥉']);

/** Quantas páginas o total de participantes rende (mínimo 1, para caber o "vazio"). */
const pageCount = (total) => Math.max(1, Math.ceil(Math.max(0, total) / PAGE_SIZE));

/**
 * Página pedida, dentro do que existe. Entrada inválida cai na primeira.
 * @param {unknown} raw
 * @param {number} total participantes
 * @returns {number} página de 1 a pageCount(total)
 */
function clampPage(raw, total) {
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(pageCount(total), value);
}

/** Offset e limite do SQL para a página. */
const pageBounds = (page) => ({ limit: PAGE_SIZE, offset: (Math.max(1, page) - 1) * PAGE_SIZE });

/**
 * Barra textual de progresso.
 * @param {number} percent 0 a 1
 */
function progressBar(percent) {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(percent * BAR_WIDTH)));
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}`;
}

/** Número com separador de milhar, no formato pt-BR. */
const formatXp = (value) => Number(value ?? 0).toLocaleString('pt-BR');

/** Prefixo da posição: medalha nas três primeiras, número depois. */
const positionLabel = (position) => MEDALS[position - 1] ?? `\`#${String(position).padStart(2, ' ')}\``;

/**
 * Uma linha do ranking.
 * @param {{ position: number, name: string, level: number, totalXp: number }} entry
 */
function formatEntryLine({ position, name, level, totalXp }) {
  return `${positionLabel(position)} **${name}** — nível **${level}** · ${formatXp(totalXp)} XP`;
}

module.exports = {
  PAGE_SIZE,
  BAR_WIDTH,
  pageCount,
  clampPage,
  pageBounds,
  progressBar,
  formatXp,
  positionLabel,
  formatEntryLine,
};
