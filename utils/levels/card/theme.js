// @ts-check
/**
 * Medidas e paleta das imagens do ranking. Nenhuma função: só os números que o
 * desenho lê, num lugar só, para ajustar espaçamento não virar caça a constante
 * espalhada por três arquivos.
 *
 * A paleta é quase toda cinza de propósito — o modelo que originou o layout é uma
 * ilustração em preto e branco, e cor forte por cima dela brigaria com o fundo
 * que cada servidor escolher.
 */

/** Layout da imagem do `/top`. */
const TOP = Object.freeze({
  width: 1000,
  padding: 40,
  /** Cabeçalho: título, frase do topo e a linha de página/participantes. */
  headerHeight: 150,
  rowHeight: 100,
  /** A primeira posição da primeira página é mais alta e clara. */
  heroHeight: 140,
  rowGap: 12,
  /** Bloco do "ninguém pontuou ainda", quando a página não tem linha nenhuma. */
  emptyHeight: 120,
  footerHeight: 56,
  radius: 18,
  /** Respiro entre a borda do cartão da linha e o conteúdo dela. */
  inner: 26,
});

/** Layout da imagem do `/rank`. */
const RANK = Object.freeze({
  width: 1000,
  height: 300,
  padding: 40,
  radius: 24,
  inner: 34,
  avatarRadius: 76,
});

/** Barras de progresso. */
const BAR = Object.freeze({ height: 10, heroHeight: 14, rankHeight: 18, radius: 9 });

const COLORS = Object.freeze({
  base: '#0e0f12',
  /** Véu sobre o fundo (gerado ou remoto) para o texto ter contraste garantido. */
  veil: 'rgba(10, 11, 14, 0.55)',
  panel: 'rgba(255, 255, 255, 0.055)',
  panelStroke: 'rgba(255, 255, 255, 0.09)',
  hero: 'rgba(238, 237, 232, 0.94)',
  heroText: '#14151a',
  heroMuted: 'rgba(20, 21, 26, 0.60)',
  heroTrack: 'rgba(20, 21, 26, 0.16)',
  heroBarFrom: '#2c2e36',
  heroBarTo: '#63697a',
  text: '#f3f4f6',
  muted: 'rgba(243, 244, 246, 0.60)',
  faint: 'rgba(243, 244, 246, 0.34)',
  track: 'rgba(255, 255, 255, 0.13)',
  barFrom: '#dcdee4',
  barTo: '#8d94a5',
  /** Ouro, prata e bronze dessaturados, para não estourar no cinza. */
  medals: Object.freeze(['#e3c778', '#c8cbd3', '#bd8a5e']),
});

module.exports = { TOP, RANK, BAR, COLORS };
