// @ts-check
/**
 * A imagem de uma página do ranking.
 *
 * A função devolve `Buffer` (PNG) ou `null`, e nunca lança: sem fonte no host,
 * com canvas quebrado ou com dado estranho vindo do banco, quem chamou cai no
 * embed de texto. Um `/top` em texto é pior que a imagem, mas é infinitamente
 * melhor que um comando que falha.
 *
 * A altura é calculada a partir do número de linhas, então uma última página com
 * três pessoas sai com três linhas de altura — não com dez e sete buracos.
 *
 * Toda linha é um cartão de papel opaco (ver [theme.js](./theme.js)). Cartão
 * translúcido deixava o fundo do servidor atravessar e o XP ficava ilegível
 * dependendo da imagem configurada.
 */

const { createCanvas } = require('@napi-rs/canvas');
const { fontStacks } = require('../../canvasFonts');
const { xpProgress } = require('../formula');
const { formatXp } = require('../leaderboard');
const { TOP, BAR, COLORS } = require('./theme');
const {
  fillRoundRect,
  roundRectPath,
  drawAccent,
  drawHatch,
  drawBadge,
  drawPill,
  fitText,
  drawBar,
  drawAvatar,
  initialOf,
} = require('./primitives');
const { paintBackground, paintEdgeScrims, loadBackgroundImage } = require('./background');
const { loadAvatars } = require('./avatars');
const { createCache } = require('./cache');

/** @typedef {import('@napi-rs/canvas').SKRSContext2D} Ctx */
/** @typedef {import('@napi-rs/canvas').Image} CanvasImage */
/** @typedef {{ display: string, body: string, mono: string, strong: string, weight: string }} Fonts */

/**
 * @typedef {Object} LeaderboardEntry
 * @property {number} position posição absoluta no ranking (não o índice na página)
 * @property {string} id
 * @property {string} name
 * @property {string|null} [avatarUrl]
 * @property {number} totalXp
 */

/**
 * Um minuto. É o suficiente para ida e volta nos botões de página não redesenhar
 * nada, e curto o bastante para XP novo aparecer rápido — embora a assinatura das
 * linhas já invalide a chave sozinha quando alguém pontua.
 */
const PAGE_TTL_MS = 60 * 1000;
const PAGE_MAX_ENTRIES = 48;

/** @type {ReturnType<typeof createCache<Buffer>>} */
const pageCache = createCache({ ttlMs: PAGE_TTL_MS, max: PAGE_MAX_ENTRIES });

/** Sombra dos cartões: separa o papel do fundo sem virar borrão. */
const CARD_SHADOW = Object.freeze({ color: 'rgba(0, 0, 0, 0.45)', blur: 16, offsetY: 5 });

/**
 * Cor da faixa lateral e do número da posição.
 * @param {number} position
 * @returns {string}
 */
const accentFor = (position) => COLORS.medals[position - 1] ?? COLORS.accentPlain;

/**
 * Altura da imagem para uma página.
 *
 * Separado do desenho para poder ser conferido em teste sem canvas nenhum.
 *
 * @param {number} rowCount linhas normais (fora o destaque)
 * @param {boolean} hasHero a página tem o card de primeiro lugar
 * @returns {number}
 */
function cardHeight(rowCount, hasHero) {
  const blocks = [];
  if (hasHero) blocks.push(TOP.heroHeight);
  for (let i = 0; i < Math.max(0, rowCount); i += 1) blocks.push(TOP.rowHeight);

  const body = blocks.length
    ? blocks.reduce((sum, h) => sum + h, 0) + TOP.rowGap * (blocks.length - 1)
    : TOP.emptyHeight;

  return TOP.padding * 2 + TOP.headerHeight + body + TOP.footerHeight;
}

/**
 * Assinatura da página: muda quando qualquer coisa visível muda.
 *
 * Inclui o XP de cada linha porque é ele que move a barra; inclui a aparência
 * porque trocar o fundo tem de invalidar o que já foi desenhado.
 *
 * @param {{ guildId: string, guildName: string, page: number, pages: number, total: number, entries: LeaderboardEntry[], headline?: string|null, backgroundUrl?: string|null }} data
 * @returns {string}
 */
function pageSignature({ guildId, guildName, page, pages, total, entries, headline, backgroundUrl }) {
  const rows = entries.map((e) => `${e.position}:${e.id}:${e.totalXp}:${e.name}:${e.avatarUrl ?? ''}`).join('|');
  return [guildId, guildName, page, pages, total, headline ?? '', backgroundUrl ?? '', rows].join('~');
}

/**
 * Hachura discreta na faixa da esquerda do cartão, atrás do selo e do avatar.
 *
 * Fica só onde não há texto: marca d'água atrás dos números é o tipo de enfeite
 * que embaralha justamente o dado que a pessoa abriu o `/top` para ler.
 *
 * @param {Ctx} ctx
 * @param {{ x: number, y: number, width: number, height: number, radius: number, band: number }} options
 */
function drawCardTexture(ctx, { x, y, width, height, radius, band }) {
  ctx.save();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.clip();
  drawHatch(ctx, { x, y, width: band, height, color: COLORS.inkGhost, gap: 16 });
  ctx.restore();
}

/**
 * Cabeçalho: título, nome do servidor, frase configurada e a página.
 *
 * @param {Ctx} ctx
 * @param {{ fonts: Fonts, width: number, guildName: string, page: number, pages: number, headline?: string|null }} options
 */
function drawHeader(ctx, { fonts, width, guildName, page, pages, headline }) {
  const left = TOP.padding + 4;
  const right = width - TOP.padding - 4;
  const top = TOP.padding;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = COLORS.pageText;
  ctx.font = `${fonts.weight}54px ${fonts.display}`;
  ctx.fillText('Ranking de XP', left, top + 52);

  ctx.font = `22px ${fonts.body}`;
  ctx.fillStyle = COLORS.pageMuted;
  ctx.fillText(fitText(ctx, guildName, width - TOP.padding * 2 - 220), left, top + 88);

  if (headline) {
    ctx.font = `20px ${fonts.body}`;
    ctx.fillStyle = COLORS.pageFaint;
    ctx.fillText(fitText(ctx, headline, width - TOP.padding * 2 - 8), left, top + 122);
  }

  drawPill(ctx, {
    text: `Página ${page}/${pages}`,
    right,
    centerY: top + 34,
    font: `${fonts.weight}20px ${fonts.strong}`,
    fill: COLORS.pageText,
    background: 'rgba(244, 243, 239, 0.10)',
    stroke: COLORS.rule,
    height: 40,
    paddingX: 18,
  });

  // Régua: fecha o cabeçalho e faz o primeiro cartão parecer apoiado nela.
  const ruleY = top + TOP.headerHeight - 16;
  ctx.fillStyle = COLORS.rule;
  ctx.fillRect(left, ruleY, width - TOP.padding * 2 - 8, 1);
}

/**
 * Card do primeiro lugar: mais alto, mais claro e com o número de marca d'água.
 *
 * @param {Ctx} ctx
 * @param {{ fonts: Fonts, width: number, y: number, entry: LeaderboardEntry, avatar: CanvasImage|null }} options
 */
function drawHeroRow(ctx, { fonts, width, y, entry, avatar }) {
  const x = TOP.padding;
  const cardWidth = width - TOP.padding * 2;
  const height = TOP.heroHeight;
  const radius = TOP.radius + 4;
  const gold = COLORS.medals[0];

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height,
    radius,
    fill: COLORS.hero,
    stroke: COLORS.heroStroke,
    shadow: CARD_SHADOW,
  });
  drawAccent(ctx, { x, y, width: cardWidth, height, radius, thickness: TOP.accentWidth, fill: gold });
  drawCardTexture(ctx, { x, y, width: cardWidth, height, radius, band: 250 });

  const progress = xpProgress(entry.totalXp);
  const centerY = y + height / 2;

  // Selo da posição: o "1" precisa de peso próprio, senão o destaque do pódio se
  // resume a o cartão ser mais alto.
  drawBadge(ctx, {
    text: '1',
    cx: x + 74,
    cy: centerY,
    radius: 34,
    font: `${fonts.weight}36px ${fonts.display}`,
    fill: COLORS.hero,
    background: gold,
  });

  drawAvatar(ctx, {
    image: avatar,
    cx: x + 190,
    cy: centerY,
    radius: 56,
    initial: initialOf(entry.name),
    family: fonts.body,
    ring: gold,
    fallbackFill: COLORS.track,
    fallbackColor: COLORS.inkMuted,
  });

  const textLeft = x + 266;
  const textRight = x + cardWidth - TOP.inner;

  ctx.textAlign = 'right';
  ctx.font = `${fonts.weight}32px ${fonts.strong}`;
  ctx.fillStyle = COLORS.ink;
  const xpLabel = `${formatXp(entry.totalXp)} XP`;
  ctx.fillText(xpLabel, textRight, y + 62);
  const xpWidth = ctx.measureText(xpLabel).width;

  ctx.font = `19px ${fonts.body}`;
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
      : 'nível máximo',
    textRight,
    y + 98
  );

  ctx.textAlign = 'left';
  ctx.font = `${fonts.weight}38px ${fonts.strong}`;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(fitText(ctx, entry.name, textRight - textLeft - xpWidth - 28), textLeft, y + 64);

  ctx.font = `${fonts.weight}22px ${fonts.strong}`;
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(`Nível ${progress.level}`, textLeft, y + 100);

  drawBar(ctx, {
    x: textLeft,
    y: y + 118,
    width: textRight - textLeft,
    height: BAR.heroHeight,
    percent: progress.percent,
  });

  ctx.font = `17px ${fonts.body}`;
  ctx.fillStyle = COLORS.inkFaint;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `faltam ${formatXp(Math.max(0, progress.xpForNextLevel - progress.xpIntoLevel))} XP`
      : 'topo da escala',
    textLeft,
    y + 158
  );

  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(progress.percent * 100)}%`, textRight, y + 158);
  ctx.textAlign = 'left';
}

/**
 * Linha comum do ranking.
 *
 * @param {Ctx} ctx
 * @param {{ fonts: Fonts, width: number, y: number, entry: LeaderboardEntry, avatar: CanvasImage|null }} options
 */
function drawRow(ctx, { fonts, width, y, entry, avatar }) {
  const x = TOP.padding;
  const cardWidth = width - TOP.padding * 2;
  const height = TOP.rowHeight;
  const radius = TOP.radius;
  const accent = accentFor(entry.position);
  const isPodium = entry.position <= 3;

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height,
    radius,
    fill: COLORS.card,
    stroke: COLORS.cardStroke,
    shadow: CARD_SHADOW,
  });
  drawAccent(ctx, { x, y, width: cardWidth, height, radius, thickness: TOP.accentWidth, fill: accent });
  drawCardTexture(ctx, { x, y, width: cardWidth, height, radius, band: 165 });

  const progress = xpProgress(entry.totalXp);
  const centerY = y + height / 2;

  drawBadge(ctx, {
    text: String(entry.position),
    cx: x + 50,
    cy: centerY,
    radius: 26,
    font: `${fonts.weight}${entry.position >= 100 ? 20 : 25}px ${fonts.display}`,
    fill: isPodium ? COLORS.card : COLORS.ink,
    background: isPodium ? accent : COLORS.inkGhost,
  });

  drawAvatar(ctx, {
    image: avatar,
    cx: x + 122,
    cy: centerY,
    radius: 34,
    initial: initialOf(entry.name),
    family: fonts.body,
    ring: isPodium ? accent : COLORS.cardStroke,
    fallbackFill: COLORS.track,
    fallbackColor: COLORS.inkMuted,
  });

  const textLeft = x + 176;
  const textRight = x + cardWidth - TOP.inner;

  ctx.textAlign = 'right';
  ctx.font = `${fonts.weight}24px ${fonts.strong}`;
  ctx.fillStyle = COLORS.ink;
  const xpLabel = `${formatXp(entry.totalXp)} XP`;
  ctx.fillText(xpLabel, textRight, y + 44);
  const xpWidth = ctx.measureText(xpLabel).width;

  ctx.font = `17px ${fonts.body}`;
  ctx.fillStyle = COLORS.inkFaint;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
      : 'nível máximo',
    textRight,
    y + 74
  );

  ctx.textAlign = 'left';
  ctx.font = `${fonts.weight}27px ${fonts.strong}`;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(fitText(ctx, entry.name, textRight - textLeft - xpWidth - 28), textLeft, y + 44);

  ctx.font = `18px ${fonts.body}`;
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(`Nível ${progress.level}`, textLeft, y + 74);

  drawBar(ctx, { x: textLeft, y: y + 86, width: textRight - textLeft, percent: progress.percent });
}

/**
 * Bloco do ranking vazio. Existe para a imagem não ter um vão sem explicação.
 *
 * @param {Ctx} ctx
 * @param {{ fonts: Fonts, width: number, y: number }} options
 */
function drawEmptyBlock(ctx, { fonts, width, y }) {
  const x = TOP.padding;
  const cardWidth = width - TOP.padding * 2;

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height: TOP.emptyHeight,
    radius: TOP.radius,
    fill: COLORS.card,
    stroke: COLORS.cardStroke,
    shadow: CARD_SHADOW,
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${fonts.weight}26px ${fonts.strong}`;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('Ninguém pontuou ainda', x + cardWidth / 2, y + 56);

  ctx.font = `18px ${fonts.body}`;
  ctx.fillStyle = COLORS.inkMuted;
  ctx.fillText(
    'Com o sistema de níveis ligado, o ranking aparece na primeira conversa.',
    x + cardWidth / 2,
    y + 88
  );
  ctx.textAlign = 'left';
}

/**
 * Rodapé com o total de participantes.
 *
 * @param {Ctx} ctx
 * @param {{ fonts: Fonts, width: number, height: number, total: number, pageSize: number }} options
 */
function drawFooter(ctx, { fonts, width, height, total, pageSize }) {
  const y = height - TOP.padding - 10;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `17px ${fonts.body}`;
  ctx.fillStyle = COLORS.pageFaint;
  ctx.fillText(`${formatXp(total)} participante(s) · ${pageSize} por página`, TOP.padding + 4, y);

  ctx.textAlign = 'right';
  ctx.fillText('/top', width - TOP.padding - 4, y);
  ctx.textAlign = 'left';
}

/**
 * PNG de uma página do ranking, ou `null` quando não é possível desenhar.
 *
 * @param {{ guildId: string, guildName: string, page: number, pages: number, total: number, pageSize: number, entries: LeaderboardEntry[], headline?: string|null, backgroundUrl?: string|null }} data
 * @returns {Promise<Buffer|null>}
 */
async function renderLeaderboardCard(data) {
  const fonts = fontStacks();
  if (!fonts) return null;

  const signature = pageSignature(data);
  const cached = pageCache.get(signature);
  if (cached) return cached;

  try {
    const entries = data.entries ?? [];
    // O destaque é o primeiro lugar de verdade, não o primeiro da página: na
    // página 2 a posição 11 é uma linha comum como qualquer outra.
    const hasHero = entries.length > 0 && entries[0].position === 1;
    const rows = hasHero ? entries.slice(1) : entries;

    const width = TOP.width;
    const height = cardHeight(rows.length, hasHero);

    const [background, avatars] = await Promise.all([
      loadBackgroundImage(data.backgroundUrl),
      loadAvatars(entries.map((entry) => entry.avatarUrl ?? null)),
    ]);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    paintBackground(ctx, { width, height, image: background });
    paintEdgeScrims(ctx, {
      width,
      height,
      top: TOP.padding + TOP.headerHeight,
      bottom: TOP.footerHeight + TOP.padding,
    });
    drawHeader(ctx, {
      fonts,
      width,
      guildName: data.guildName,
      page: data.page,
      pages: data.pages,
      headline: data.headline,
    });

    let y = TOP.padding + TOP.headerHeight;

    if (!entries.length) {
      drawEmptyBlock(ctx, { fonts, width, y });
    } else {
      if (hasHero) {
        drawHeroRow(ctx, { fonts, width, y, entry: entries[0], avatar: avatars.get(entries[0].avatarUrl ?? '') ?? null });
        y += TOP.heroHeight + TOP.rowGap;
      }

      for (const entry of rows) {
        drawRow(ctx, { fonts, width, y, entry, avatar: avatars.get(entry.avatarUrl ?? '') ?? null });
        y += TOP.rowHeight + TOP.rowGap;
      }
    }

    drawFooter(ctx, { fonts, width, height, total: data.total, pageSize: data.pageSize });

    return pageCache.set(signature, canvas.toBuffer('image/png'));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[levels] falha ao desenhar a imagem do ranking:', motivo);
    return null;
  }
}

module.exports = {
  PAGE_TTL_MS,
  PAGE_MAX_ENTRIES,
  pageCache,
  cardHeight,
  pageSignature,
  renderLeaderboardCard,
};
