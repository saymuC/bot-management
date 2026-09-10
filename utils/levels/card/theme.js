// @ts-check
/**
 * Medidas e paleta das imagens do ranking. Nenhuma função: só os números que o
 * desenho lê, num lugar só, para ajustar espaçamento não virar caça a constante
 * espalhada por três arquivos.
 *
 * A decisão que organiza a paleta inteira: **texto escuro sobre cartão claro**, e
 * não texto claro sobre cartão translúcido. Cartão translúcido deixa o fundo do
 * servidor atravessar e aí a legibilidade depende da imagem que o admin escolheu —
 * um fundo claro, e os números somem. Cartão de papel opaco vale sobre qualquer
 * fundo, e é também o que aproxima o resultado do pôster que originou o layout.
 *
 * Por isso há dois conjuntos de cor: `page` para o que fica sobre o fundo
 * (cabeçalho e rodapé, texto claro) e `ink` para o que fica sobre o papel.
 */

/** Layout da imagem do `/top`. */
const TOP = Object.freeze({
  width: 1000,
  padding: 44,
  /** Cabeçalho: título, frase do topo, a régua e a linha de página. */
  headerHeight: 178,
  rowHeight: 112,
  /** A primeira posição da primeira página é mais alta e mais clara. */
  heroHeight: 182,
  rowGap: 14,
  /** Bloco do "ninguém pontuou ainda", quando a página não tem linha nenhuma. */
  emptyHeight: 130,
  footerHeight: 62,
  radius: 20,
  /** Respiro entre a borda do cartão da linha e o conteúdo dela. */
  inner: 28,
  /** Faixa de cor na borda esquerda do cartão, que marca as três primeiras. */
  accentWidth: 7,
});

/** Layout da imagem do `/rank`. */
const RANK = Object.freeze({
  width: 1000,
  height: 360,
  padding: 40,
  radius: 26,
  inner: 40,
  avatarRadius: 86,
  /** Selo do nível, grudado no canto inferior direito do avatar. */
  badgeRadius: 34,
});

/** Barras de progresso. */
const BAR = Object.freeze({ height: 14, heroHeight: 18, rankHeight: 22 });

const COLORS = Object.freeze({
  base: '#0d0e11',
  /**
   * Véu sobre o fundo (gerado ou remoto).
   *
   * Médio, não denso: como os cartões passaram a ser papel opaco, a legibilidade
   * não depende mais de escurecer o fundo, e escurecer demais desperdiçaria a
   * imagem que o admin configurou. O que ainda fica direto sobre o fundo —
   * cabeçalho e rodapé — é protegido pelo `scrim` abaixo, e não pelo véu.
   */
  veil: 'rgba(9, 10, 13, 0.50)',
  /**
   * Degradê nas duas pontas da imagem, atrás do cabeçalho e do rodapé.
   *
   * É o que mantém o texto claro legível sobre uma foto clara sem apagar o meio
   * da imagem, onde de todo modo os cartões cobrem o fundo.
   */
  scrim: 'rgba(9, 10, 13, 0.82)',

  /** Papel dos cartões. Opaco: nada do fundo atravessa. */
  card: '#e8e6de',
  cardStroke: 'rgba(23, 24, 29, 0.14)',
  /** O cartão do primeiro lugar é mais claro que os outros, além de mais alto. */
  hero: '#faf8f2',
  heroStroke: 'rgba(23, 24, 29, 0.18)',

  /** Texto sobre o papel. */
  ink: '#17181d',
  inkMuted: 'rgba(23, 24, 29, 0.58)',
  inkFaint: 'rgba(23, 24, 29, 0.34)',
  /** Número gigante de marca d'água dentro do cartão. */
  inkGhost: 'rgba(23, 24, 29, 0.07)',
  /** Barra sobre o papel. */
  track: 'rgba(23, 24, 29, 0.13)',
  barFrom: '#2a2c34',
  barTo: '#6f7683',

  /** Texto sobre o fundo (cabeçalho e rodapé). */
  pageText: '#f4f3ef',
  pageMuted: 'rgba(244, 243, 239, 0.66)',
  pageFaint: 'rgba(244, 243, 239, 0.40)',
  rule: 'rgba(244, 243, 239, 0.22)',

  /**
   * Ouro, prata e bronze escurecidos para funcionarem **sobre papel claro** — o
   * dourado claro do mockup desaparece num cartão branco.
   */
  medals: Object.freeze(['#b98c22', '#7c8290', '#a2643a']),
  /** Faixa lateral das posições fora do pódio. */
  accentPlain: 'rgba(23, 24, 29, 0.18)',
});

module.exports = { TOP, RANK, BAR, COLORS };
