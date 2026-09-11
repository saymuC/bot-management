// @ts-check
/**
 * Traduz o tema salvo pelo admin em paleta e medidas prontas para o desenho.
 *
 * Os módulos de desenho não sabem o que é um preset: eles recebem um **visual
 * resolvido** com as mesmas chaves que o `COLORS` estático tinha, mais os flags de
 * liga/desliga. Toda a decisão de cor mora aqui.
 *
 * A regra que organiza o arquivo: o admin escolhe as **superfícies** (papel, fundo,
 * destaque) e nunca o texto. A tinta sai da luminância do papel, então um papel
 * escolhido à mão continua legível — foi legibilidade que motivou o layout de papel
 * opaco, e um hex livre para o texto reabriria exatamente esse problema.
 */

const { THEME_PRESETS, ACCENT_COLORS, DEFAULT_THEME } = require('../../../config/levels');
const { TOP, RANK, BAR } = require('./theme');

/** Tinta escura, para papel claro. */
const INK_DARK = '#17181d';
/** Tinta clara, para papel escuro. */
const INK_LIGHT = '#f4f3ef';

/** Ouro, prata e bronze escurecidos, legíveis sobre papel claro. */
const MEDALS_ON_LIGHT = Object.freeze(['#b98c22', '#7c8290', '#a2643a']);
/** As mesmas três clareadas, para papel escuro. */
const MEDALS_ON_DARK = Object.freeze(['#e0b95a', '#c3c9d4', '#d79a6a']);

/**
 * `#rrggbb` em componentes. Assume hex de 6 dígitos — é o que a normalização
 * garante, e o catálogo é escrito à mão no mesmo formato.
 *
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
  const text = String(hex).trim().replace(/^#/, '');
  const value = Number.parseInt(text.length === 3 ? text.replace(/(.)/g, '$1$1') : text, 16);
  if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** Componentes em `#rrggbb`. */
const rgbToHex = ({ r, g, b }) =>
  `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Mesma cor com alfa, no formato que o canvas aceita.
 *
 * O espaçamento e as duas casas do alfa são deliberados: é o formato das strings
 * que estavam escritas à mão na paleta antiga, e manter a forma faz a comparação
 * "o tema padrão continua idêntico" ser uma comparação de string.
 *
 * @param {string} hex
 * @param {number} alpha 0 a 1
 */
function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(2)})`;
}

/**
 * Interpolação linear entre duas cores.
 * @param {string} from
 * @param {string} to
 * @param {number} t 0 = `from`, 1 = `to`
 */
function mix(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
}

/**
 * Luminância relativa (WCAG), 0 = preto, 1 = branco.
 * @param {string} hex
 */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Tinta legível sobre a superfície informada.
 *
 * Só duas saídas, e não um cálculo contínuo: a paleta inteira deriva desta cor por
 * alfa, e dois tons bem escolhidos dão mais controle do desenho que um valor
 * inventado a cada hex.
 *
 * @param {string} surface
 */
const contrastInk = (surface) => (luminance(surface) > 0.42 ? INK_DARK : INK_LIGHT);

/**
 * Assinatura curta do tema, usada para memoizar e para invalidar o cache de página.
 * @param {import('../types').LevelsTheme} theme
 */
function themeSignature(theme) {
  return [
    theme.preset,
    theme.accent,
    theme.cardColor ?? '-',
    theme.accentColor ?? '-',
    theme.veil,
    theme.corners,
    theme.title ?? '-',
    theme.showAvatars ? 1 : 0,
    theme.showBars ? 1 : 0,
    theme.showTexture ? 1 : 0,
    theme.showShadow ? 1 : 0,
    theme.showMedals ? 1 : 0,
    theme.showFooter ? 1 : 0,
  ].join('|');
}

/**
 * Visuais já resolvidos, por assinatura.
 *
 * O preview redesenha a cada clique e o `/top` desenha dez linhas por imagem;
 * recalcular a paleta em cada uma seria trabalho repetido para um resultado que só
 * muda quando o tema muda. O teto existe porque a chave inclui texto livre (o
 * título), então um servidor renomeando o ranking não pode crescer o mapa sem fim.
 */
const cache = new Map();
const CACHE_MAX = 32;

/**
 * @param {unknown} raw
 * @returns {import('../types').LevelsTheme}
 */
const withDefaults = (raw) => ({ ...DEFAULT_THEME, ...(raw && typeof raw === 'object' ? raw : {}) });

/**
 * Paleta e medidas do tema.
 *
 * Aceita tema parcial ou ausente e completa com o default — o desenho é chamado de
 * lugares que ainda passam config antiga, e cair para o visual padrão é melhor que
 * falhar no meio de um render.
 *
 * @param {unknown} rawTheme
 */
function resolveVisual(rawTheme) {
  const theme = withDefaults(rawTheme);
  const signature = themeSignature(theme);

  const cached = cache.get(signature);
  if (cached) return cached;

  const preset = THEME_PRESETS[theme.preset] ?? THEME_PRESETS[DEFAULT_THEME.preset];
  const accentEntry = ACCENT_COLORS[theme.accent] ?? ACCENT_COLORS[DEFAULT_THEME.accent];

  // Papel: o hex do admin manda; sem ele, o do preset. O cartão do primeiro lugar é
  // uma versão mais clara do papel, para o destaque não depender de um segundo hex.
  const card = theme.cardColor ?? preset.card;
  const hero = theme.cardColor ? mix(card, '#ffffff', 0.08) : preset.hero;

  const ink = contrastInk(card);
  const onDarkPaper = ink === INK_LIGHT;
  const page = preset.page;

  const accent = theme.accentColor ?? accentEntry.hex;
  const accentTo = theme.accentColor ? mix(accent, '#ffffff', 0.35) : accentEntry.to;
  const plateInk = contrastInk(accent);

  const veilAlpha = Math.max(0, Math.min(0.9, theme.veil / 100));
  // O scrim acompanha o véu porque protege o mesmo texto: com o fundo mais visível,
  // o cabeçalho precisa de mais proteção nas pontas, não de menos.
  const scrimAlpha = Math.max(0.4, Math.min(0.95, veilAlpha + 0.32));

  const medals = theme.showMedals
    ? [...(onDarkPaper ? MEDALS_ON_DARK : MEDALS_ON_LIGHT)]
    : [accent, accent, accent];

  const colors = Object.freeze({
    base: preset.base,
    gradient: [...preset.gradient],
    veil: withAlpha(preset.base, veilAlpha),
    scrim: withAlpha(preset.base, scrimAlpha),

    card,
    cardStroke: withAlpha(ink, 0.14),
    hero,
    heroStroke: withAlpha(ink, 0.18),

    ink,
    inkMuted: withAlpha(ink, 0.58),
    inkFaint: withAlpha(ink, 0.34),
    inkGhost: withAlpha(ink, 0.07),
    track: withAlpha(ink, 0.13),
    barFrom: accent,
    barTo: accentTo,

    pageText: page,
    pageMuted: withAlpha(page, 0.66),
    pageFaint: withAlpha(page, 0.4),
    rule: withAlpha(page, 0.22),
    /** Fundo da cápsula de página, sobre o fundo da imagem. */
    pageWash: withAlpha(page, 0.1),

    medals: Object.freeze(medals),
    accent,
    accentPlain: withAlpha(accent, 0.18),

    /** Texto e detalhes sobre a placa de destaque do `/rank`. */
    plateInk,
    plateMuted: withAlpha(plateInk, 0.66),
    plateFaint: withAlpha(plateInk, 0.4),
    plateHatch: withAlpha(plateInk, 0.06),
    plateGlow: withAlpha(plateInk, 0.14),
    /** Parada final do brilho da placa; a mesma cor sem opacidade nenhuma. */
    plateTransparent: withAlpha(plateInk, 0),
    plateRing: withAlpha(plateInk, 0.35),
    /** Fio que separa a placa do papel; escuro em qualquer combinação. */
    seam: 'rgba(0, 0, 0, 0.35)',
  });

  const square = theme.corners === 'square';
  const top = Object.freeze({
    ...TOP,
    radius: square ? 0 : TOP.radius,
    footerHeight: theme.showFooter ? TOP.footerHeight : 0,
  });
  const rank = Object.freeze({ ...RANK, radius: square ? 0 : RANK.radius });

  const flags = Object.freeze({
    showAvatars: theme.showAvatars,
    showBars: theme.showBars,
    showTexture: theme.showTexture,
    showShadow: theme.showShadow,
    showMedals: theme.showMedals,
    showFooter: theme.showFooter,
  });

  const visual = Object.freeze({ signature, title: theme.title, colors, top, rank, bar: BAR, flags });

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(signature, visual);
  return visual;
}

module.exports = { hexToRgb, rgbToHex, withAlpha, mix, luminance, contrastInk, themeSignature, resolveVisual };
