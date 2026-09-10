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
 */

const { createCanvas } = require('@napi-rs/canvas');
const { fontStacks } = require('../../canvasFonts');
const { xpProgress } = require('../formula');
const { formatXp } = require('../leaderboard');
const { TOP, BAR, COLORS } = require('./theme');
const { fillRoundRect, fitText, drawBar, drawAvatar, initialOf } = require('./primitives');
const { paintBackground, loadBackgroundImage } = require('./background');
const { loadAvatars } = require('./avatars');
const { createCache } = require('./cache');

/** @typedef {import('@napi-rs/canvas').SKRSContext2D} Ctx */
/** @typedef {import('@napi-rs/canvas').Image} CanvasImage */

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
 * Cabeçalho: título, nome do servidor, frase configurada e a página.
 *
 * @param {Ctx} ctx
 * @param {{ families: { display: string, body: string }, width: number, guildName: string, page: number, pages: number, headline?: string|null }} options
 */
function drawHeader(ctx, { families, width, guildName, page, pages, headline }) {
  const left = TOP.padding + 4;
  const right = width - TOP.padding - 4;
  const top = TOP.padding;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = COLORS.text;
  ctx.font = `bold 46px ${families.display}`;
  ctx.fillText('Ranking de XP', left, top + 46);

  ctx.font = `20px ${families.body}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(fitText(ctx, guildName, width - TOP.padding * 2 - 200), left, top + 78);

  if (headline) {
    ctx.font = `18px ${families.body}`;
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(fitText(ctx, headline, width - TOP.padding * 2 - 8), left, top + 108);
  }

  ctx.textAlign = 'right';
  ctx.font = `bold 20px ${families.body}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(`Página ${page}/${pages}`, right, top + 46);
  ctx.textAlign = 'left';
}

/**
 * Card do primeiro lugar: mais alto, claro, com o número em destaque.
 *
 * @param {Ctx} ctx
 * @param {{ families: { display: string, body: string }, width: number, y: number, entry: LeaderboardEntry, avatar: CanvasImage|null }} options
 */
function drawHeroRow(ctx, { families, width, y, entry, avatar }) {
  const x = TOP.padding;
  const cardWidth = width - TOP.padding * 2;
  const height = TOP.heroHeight;

  fillRoundRect(ctx, { x, y, width: cardWidth, height, radius: TOP.radius + 4, fill: COLORS.hero });

  const progress = xpProgress(entry.totalXp);
  const centerY = y + height / 2;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  // Número, não coroa: emoji depende de uma fonte de emoji instalada no host, e
  // onde ela não existe o destaque virava um quadradinho.
  ctx.font = `bold 40px ${families.display}`;
  ctx.fillStyle = COLORS.medals[0] ?? COLORS.heroText;
  ctx.fillText('1', x + 52, centerY + 14);

  drawAvatar(ctx, {
    image: avatar,
    cx: x + 148,
    cy: centerY,
    radius: 44,
    initial: initialOf(entry.name),
    family: families.body,
    ring: 'rgba(20, 21, 26, 0.22)',
    fallbackFill: 'rgba(20, 21, 26, 0.12)',
    fallbackColor: COLORS.heroMuted,
  });

  const textLeft = x + 210;
  const textRight = x + cardWidth - TOP.inner;

  ctx.textAlign = 'right';
  ctx.font = `bold 24px ${families.body}`;
  ctx.fillStyle = COLORS.heroText;
  const xpLabel = `${formatXp(entry.totalXp)} XP`;
  ctx.fillText(xpLabel, textRight, y + 52);
  const xpWidth = ctx.measureText(xpLabel).width;

  ctx.font = `16px ${families.body}`;
  ctx.fillStyle = COLORS.heroMuted;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
      : 'nível máximo',
    textRight,
    y + 80
  );

  ctx.textAlign = 'left';
  ctx.font = `bold 34px ${families.display}`;
  ctx.fillStyle = COLORS.heroText;
  ctx.fillText(fitText(ctx, entry.name, textRight - textLeft - xpWidth - 24), textLeft, y + 54);

  ctx.font = `19px ${families.body}`;
  ctx.fillStyle = COLORS.heroMuted;
  ctx.fillText(`Nível ${progress.level}`, textLeft, y + 82);

  drawBar(ctx, {
    x: textLeft,
    y: y + 100,
    width: textRight - textLeft,
    height: BAR.heroHeight,
    percent: progress.percent,
    track: COLORS.heroTrack,
    from: COLORS.heroBarFrom,
    to: COLORS.heroBarTo,
  });
}

/**
 * Linha comum do ranking.
 *
 * @param {Ctx} ctx
 * @param {{ families: { display: string, body: string }, width: number, y: number, entry: LeaderboardEntry, avatar: CanvasImage|null }} options
 */
function drawRow(ctx, { families, width, y, entry, avatar }) {
  const x = TOP.padding;
  const cardWidth = width - TOP.padding * 2;
  const height = TOP.rowHeight;

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height,
    radius: TOP.radius,
    fill: COLORS.panel,
    stroke: COLORS.panelStroke,
  });

  const progress = xpProgress(entry.totalXp);
  const centerY = y + height / 2;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';
  ctx.font = `bold 22px ${families.body}`;
  ctx.fillStyle = COLORS.medals[entry.position - 1] ?? COLORS.faint;
  ctx.fillText(String(entry.position), x + 40, centerY + 8);

  drawAvatar(ctx, {
    image: avatar,
    cx: x + 112,
    cy: centerY,
    radius: 28,
    initial: initialOf(entry.name),
    family: families.body,
    ring: 'rgba(255, 255, 255, 0.14)',
  });

  const textLeft = x + 156;
  const textRight = x + cardWidth - TOP.inner;

  ctx.textAlign = 'right';
  ctx.font = `bold 20px ${families.body}`;
  ctx.fillStyle = COLORS.text;
  const xpLabel = `${formatXp(entry.totalXp)} XP`;
  ctx.fillText(xpLabel, textRight, y + 36);
  const xpWidth = ctx.measureText(xpLabel).width;

  ctx.font = `15px ${families.body}`;
  ctx.fillStyle = COLORS.faint;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
      : 'nível máximo',
    textRight,
    y + 62
  );

  ctx.textAlign = 'left';
  ctx.font = `bold 23px ${families.body}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(fitText(ctx, entry.name, textRight - textLeft - xpWidth - 24), textLeft, y + 36);

  ctx.font = `16px ${families.body}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(`Nível ${progress.level}`, textLeft, y + 62);

  drawBar(ctx, { x: textLeft, y: y + 76, width: textRight - textLeft, percent: progress.percent });
}

/**
 * Bloco do ranking vazio. Existe para a imagem não ter um vão sem explicação.
 *
 * @param {Ctx} ctx
 * @param {{ families: { body: string }, width: number, y: number }} options
 */
function drawEmptyBlock(ctx, { families, width, y }) {
  const x = TOP.padding;
  const cardWidth = width - TOP.padding * 2;

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height: TOP.emptyHeight,
    radius: TOP.radius,
    fill: COLORS.panel,
    stroke: COLORS.panelStroke,
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `bold 22px ${families.body}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText('Ninguém pontuou ainda', x + cardWidth / 2, y + 52);

  ctx.font = `16px ${families.body}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText(
    'Com o sistema de níveis ligado, o ranking aparece na primeira conversa.',
    x + cardWidth / 2,
    y + 82
  );
  ctx.textAlign = 'left';
}

/**
 * Rodapé com o total de participantes.
 *
 * @param {Ctx} ctx
 * @param {{ families: { body: string }, width: number, height: number, total: number, pageSize: number }} options
 */
function drawFooter(ctx, { families, width, height, total, pageSize }) {
  const y = height - TOP.padding - 12;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `16px ${families.body}`;
  ctx.fillStyle = COLORS.faint;
  ctx.fillText(`${formatXp(total)} participante(s) · ${pageSize} por página`, TOP.padding + 4, y);
}

/**
 * PNG de uma página do ranking, ou `null` quando não é possível desenhar.
 *
 * @param {{ guildId: string, guildName: string, page: number, pages: number, total: number, pageSize: number, entries: LeaderboardEntry[], headline?: string|null, backgroundUrl?: string|null }} data
 * @returns {Promise<Buffer|null>}
 */
async function renderLeaderboardCard(data) {
  const families = fontStacks();
  if (!families) return null;

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
    drawHeader(ctx, {
      families,
      width,
      guildName: data.guildName,
      page: data.page,
      pages: data.pages,
      headline: data.headline,
    });

    let y = TOP.padding + TOP.headerHeight;

    if (!entries.length) {
      drawEmptyBlock(ctx, { families, width, y });
    } else {
      if (hasHero) {
        drawHeroRow(ctx, { families, width, y, entry: entries[0], avatar: avatars.get(entries[0].avatarUrl ?? '') ?? null });
        y += TOP.heroHeight + TOP.rowGap;
      }

      for (const entry of rows) {
        drawRow(ctx, { families, width, y, entry, avatar: avatars.get(entry.avatarUrl ?? '') ?? null });
        y += TOP.rowHeight + TOP.rowGap;
      }
    }

    drawFooter(ctx, { families, width, height, total: data.total, pageSize: data.pageSize });

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
