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
 * Toda linha é um cartão de papel opaco. Cartão translúcido deixava o fundo do
 * servidor atravessar e o XP ficava ilegível dependendo da imagem configurada.
 *
 * Nenhuma cor é decidida aqui: o desenho recebe o **visual resolvido** de
 * [visual.js](./visual.js), que traduz o tema do servidor em paleta e medidas.
 */

const { createCanvas } = require('@napi-rs/canvas');
const { fontStacks } = require('../../canvasFonts');
const { xpProgress } = require('../formula');
const { formatXp } = require('../leaderboard');
const { TOP } = require('./theme');
const { resolveVisual } = require('./visual');
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
/** @typedef {ReturnType<typeof resolveVisual>} Visual */

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
 * @param {Visual} v
 * @param {number} position
 * @returns {string}
 */
const accentFor = (v, position) => v.colors.medals[position - 1] ?? v.colors.accentPlain;

/**
 * Altura da imagem para uma página.
 *
 * Separado do desenho para poder ser conferido em teste sem canvas nenhum. O
 * terceiro parâmetro existe porque o rodapé desligado não pode reservar altura —
 * sobraria uma faixa vazia no pé da imagem.
 *
 * @param {number} rowCount linhas normais (fora o destaque)
 * @param {boolean} hasHero a página tem o card de primeiro lugar
 * @param {typeof TOP} [top] medidas já ajustadas pelo tema
 * @returns {number}
 */
function cardHeight(rowCount, hasHero, top = TOP) {
  const blocks = [];
  if (hasHero) blocks.push(top.heroHeight);
  for (let i = 0; i < Math.max(0, rowCount); i += 1) blocks.push(top.rowHeight);

  const body = blocks.length
    ? blocks.reduce((sum, h) => sum + h, 0) + top.rowGap * (blocks.length - 1)
    : top.emptyHeight;

  return top.padding * 2 + top.headerHeight + body + top.footerHeight;
}

/**
 * Assinatura da página: muda quando qualquer coisa visível muda.
 *
 * Inclui o XP de cada linha porque é ele que move a barra; inclui a aparência
 * porque trocar o fundo ou o tema tem de invalidar o que já foi desenhado — sem a
 * assinatura do tema, mudar uma cor devolveria a imagem antiga do cache e o
 * preview do painel pareceria travado.
 *
 * @param {{ guildId: string, guildName: string, page: number, pages: number, total: number, entries: LeaderboardEntry[], headline?: string|null, backgroundUrl?: string|null, theme?: unknown }} data
 * @returns {string}
 */
function pageSignature({ guildId, guildName, page, pages, total, entries, headline, backgroundUrl, theme }) {
  const rows = entries.map((e) => `${e.position}:${e.id}:${e.totalXp}:${e.name}:${e.avatarUrl ?? ''}`).join('|');
  const visual = resolveVisual(theme).signature;
  return [guildId, guildName, page, pages, total, headline ?? '', backgroundUrl ?? '', visual, rows].join('~');
}

/**
 * Hachura discreta na faixa da esquerda do cartão, atrás do selo e do avatar.
 *
 * Fica só onde não há texto: marca d'água atrás dos números é o tipo de enfeite
 * que embaralha justamente o dado que a pessoa abriu o `/top` para ler.
 *
 * @param {Ctx} ctx
 * @param {{ v: Visual, x: number, y: number, width: number, height: number, radius: number, band: number }} options
 */
function drawCardTexture(ctx, { v, x, y, width, height, radius, band }) {
  if (!v.flags.showTexture) return;

  ctx.save();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.clip();
  drawHatch(ctx, { x, y, width: band, height, color: v.colors.inkGhost, gap: 16 });
  ctx.restore();
}

/**
 * Cabeçalho: título, nome do servidor, frase configurada e a página.
 *
 * @param {Ctx} ctx
 * @param {{ v: Visual, fonts: Fonts, width: number, guildName: string, page: number, pages: number, headline?: string|null }} options
 */
function drawHeader(ctx, { v, fonts, width, guildName, page, pages, headline }) {
  const { colors, top: T } = v;
  const left = T.padding + 4;
  const right = width - T.padding - 4;
  const top = T.padding;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = colors.pageText;
  ctx.font = `${fonts.weight}54px ${fonts.display}`;
  ctx.fillText(fitText(ctx, v.title ?? 'Ranking de XP', width - T.padding * 2 - 230), left, top + 52);

  ctx.font = `22px ${fonts.body}`;
  ctx.fillStyle = colors.pageMuted;
  ctx.fillText(fitText(ctx, guildName, width - T.padding * 2 - 220), left, top + 88);

  if (headline) {
    ctx.font = `20px ${fonts.body}`;
    ctx.fillStyle = colors.pageFaint;
    ctx.fillText(fitText(ctx, headline, width - T.padding * 2 - 8), left, top + 122);
  }

  drawPill(ctx, {
    text: `Página ${page}/${pages}`,
    right,
    centerY: top + 34,
    font: `${fonts.weight}20px ${fonts.strong}`,
    fill: colors.pageText,
    background: colors.pageWash,
    stroke: colors.rule,
    height: 40,
    paddingX: 18,
  });

  // Régua: fecha o cabeçalho e faz o primeiro cartão parecer apoiado nela.
  const ruleY = top + T.headerHeight - 16;
  ctx.fillStyle = colors.rule;
  ctx.fillRect(left, ruleY, width - T.padding * 2 - 8, 1);
}

/**
 * Card do primeiro lugar: mais alto, mais claro e com o selo em destaque.
 *
 * @param {Ctx} ctx
 * @param {{ v: Visual, fonts: Fonts, width: number, y: number, entry: LeaderboardEntry, avatar: CanvasImage|null }} options
 */
function drawHeroRow(ctx, { v, fonts, width, y, entry, avatar }) {
  const { colors, flags, top: T, bar } = v;
  const x = T.padding;
  const cardWidth = width - T.padding * 2;
  const height = T.heroHeight;
  const radius = T.radius ? T.radius + 4 : 0;
  const gold = colors.medals[0];

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height,
    radius,
    fill: colors.hero,
    stroke: colors.heroStroke,
    shadow: flags.showShadow ? CARD_SHADOW : undefined,
  });
  drawAccent(ctx, { x, y, width: cardWidth, height, radius, thickness: T.accentWidth, fill: gold });
  drawCardTexture(ctx, { v, x, y, width: cardWidth, height, radius, band: flags.showAvatars ? 250 : 150 });

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
    fill: colors.hero,
    background: gold,
  });

  if (flags.showAvatars) {
    drawAvatar(ctx, {
      image: avatar,
      cx: x + 190,
      cy: centerY,
      radius: 56,
      initial: initialOf(entry.name),
      family: fonts.body,
      ring: gold,
      fallbackFill: colors.track,
      fallbackColor: colors.inkMuted,
    });
  }

  // Sem avatar o texto avança para onde ele começava: um vão de 130 px no meio do
  // cartão de destaque leria como imagem que não carregou.
  const textLeft = x + (flags.showAvatars ? 266 : 134);
  const textRight = x + cardWidth - T.inner;

  ctx.textAlign = 'right';
  ctx.font = `${fonts.weight}32px ${fonts.strong}`;
  ctx.fillStyle = colors.ink;
  const xpLabel = `${formatXp(entry.totalXp)} XP`;
  ctx.fillText(xpLabel, textRight, y + 62);
  const xpWidth = ctx.measureText(xpLabel).width;

  ctx.font = `19px ${fonts.body}`;
  ctx.fillStyle = colors.inkMuted;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
      : 'nível máximo',
    textRight,
    y + 98
  );

  ctx.textAlign = 'left';
  ctx.font = `${fonts.weight}38px ${fonts.strong}`;
  ctx.fillStyle = colors.ink;
  ctx.fillText(fitText(ctx, entry.name, textRight - textLeft - xpWidth - 28), textLeft, y + 64);

  ctx.font = `${fonts.weight}22px ${fonts.strong}`;
  ctx.fillStyle = colors.inkMuted;
  ctx.fillText(`Nível ${progress.level}`, textLeft, y + 100);

  if (flags.showBars) {
    drawBar(ctx, {
      x: textLeft,
      y: y + 118,
      width: textRight - textLeft,
      height: bar.heroHeight,
      percent: progress.percent,
      track: colors.track,
      from: colors.barFrom,
      to: colors.barTo,
    });
  }

  ctx.font = `17px ${fonts.body}`;
  ctx.fillStyle = colors.inkFaint;
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
 * @param {{ v: Visual, fonts: Fonts, width: number, y: number, entry: LeaderboardEntry, avatar: CanvasImage|null }} options
 */
function drawRow(ctx, { v, fonts, width, y, entry, avatar }) {
  const { colors, flags, top: T } = v;
  const x = T.padding;
  const cardWidth = width - T.padding * 2;
  const height = T.rowHeight;
  const radius = T.radius;
  const accent = accentFor(v, entry.position);
  const isPodium = entry.position <= 3;

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height,
    radius,
    fill: colors.card,
    stroke: colors.cardStroke,
    shadow: flags.showShadow ? CARD_SHADOW : undefined,
  });
  drawAccent(ctx, { x, y, width: cardWidth, height, radius, thickness: T.accentWidth, fill: accent });
  drawCardTexture(ctx, { v, x, y, width: cardWidth, height, radius, band: flags.showAvatars ? 165 : 100 });

  const progress = xpProgress(entry.totalXp);
  const centerY = y + height / 2;

  drawBadge(ctx, {
    text: String(entry.position),
    cx: x + 50,
    cy: centerY,
    radius: 26,
    font: `${fonts.weight}${entry.position >= 100 ? 20 : 25}px ${fonts.display}`,
    fill: isPodium ? colors.card : colors.ink,
    background: isPodium ? accent : colors.inkGhost,
  });

  if (flags.showAvatars) {
    drawAvatar(ctx, {
      image: avatar,
      cx: x + 122,
      cy: centerY,
      radius: 34,
      initial: initialOf(entry.name),
      family: fonts.body,
      ring: isPodium ? accent : colors.cardStroke,
      fallbackFill: colors.track,
      fallbackColor: colors.inkMuted,
    });
  }

  const textLeft = x + (flags.showAvatars ? 176 : 96);
  const textRight = x + cardWidth - T.inner;

  ctx.textAlign = 'right';
  ctx.font = `${fonts.weight}24px ${fonts.strong}`;
  ctx.fillStyle = colors.ink;
  const xpLabel = `${formatXp(entry.totalXp)} XP`;
  ctx.fillText(xpLabel, textRight, y + 44);
  const xpWidth = ctx.measureText(xpLabel).width;

  ctx.font = `17px ${fonts.body}`;
  ctx.fillStyle = colors.inkFaint;
  ctx.fillText(
    progress.xpForNextLevel > 0
      ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
      : 'nível máximo',
    textRight,
    y + 74
  );

  ctx.textAlign = 'left';
  ctx.font = `${fonts.weight}27px ${fonts.strong}`;
  ctx.fillStyle = colors.ink;
  ctx.fillText(fitText(ctx, entry.name, textRight - textLeft - xpWidth - 28), textLeft, y + 44);

  ctx.font = `18px ${fonts.body}`;
  ctx.fillStyle = colors.inkMuted;
  ctx.fillText(`Nível ${progress.level}`, textLeft, y + 74);

  if (flags.showBars) {
    drawBar(ctx, {
      x: textLeft,
      y: y + 86,
      width: textRight - textLeft,
      percent: progress.percent,
      track: colors.track,
      from: colors.barFrom,
      to: colors.barTo,
    });
  }
}

/**
 * Bloco do ranking vazio. Existe para a imagem não ter um vão sem explicação.
 *
 * @param {Ctx} ctx
 * @param {{ v: Visual, fonts: Fonts, width: number, y: number }} options
 */
function drawEmptyBlock(ctx, { v, fonts, width, y }) {
  const { colors, flags, top: T } = v;
  const x = T.padding;
  const cardWidth = width - T.padding * 2;

  fillRoundRect(ctx, {
    x,
    y,
    width: cardWidth,
    height: T.emptyHeight,
    radius: T.radius,
    fill: colors.card,
    stroke: colors.cardStroke,
    shadow: flags.showShadow ? CARD_SHADOW : undefined,
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${fonts.weight}26px ${fonts.strong}`;
  ctx.fillStyle = colors.ink;
  ctx.fillText('Ninguém pontuou ainda', x + cardWidth / 2, y + 56);

  ctx.font = `18px ${fonts.body}`;
  ctx.fillStyle = colors.inkMuted;
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
 * @param {{ v: Visual, fonts: Fonts, width: number, height: number, total: number, pageSize: number }} options
 */
function drawFooter(ctx, { v, fonts, width, height, total, pageSize }) {
  const { colors, top: T } = v;
  const y = height - T.padding - 10;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `17px ${fonts.body}`;
  ctx.fillStyle = colors.pageFaint;
  ctx.fillText(`${formatXp(total)} participante(s) · ${pageSize} por página`, T.padding + 4, y);

  ctx.textAlign = 'right';
  ctx.fillText('/top', width - T.padding - 4, y);
  ctx.textAlign = 'left';
}

/**
 * PNG de uma página do ranking, ou `null` quando não é possível desenhar.
 *
 * @param {{ guildId: string, guildName: string, page: number, pages: number, total: number, pageSize: number, entries: LeaderboardEntry[], headline?: string|null, backgroundUrl?: string|null, theme?: unknown }} data
 * @returns {Promise<Buffer|null>}
 */
async function renderLeaderboardCard(data) {
  const fonts = fontStacks();
  if (!fonts) return null;

  const signature = pageSignature(data);
  const cached = pageCache.get(signature);
  if (cached) return cached;

  try {
    const v = resolveVisual(data.theme);
    const T = v.top;

    const entries = data.entries ?? [];
    // O destaque é o primeiro lugar de verdade, não o primeiro da página: na
    // página 2 a posição 11 é uma linha comum como qualquer outra.
    const hasHero = entries.length > 0 && entries[0].position === 1;
    const rows = hasHero ? entries.slice(1) : entries;

    const width = T.width;
    const height = cardHeight(rows.length, hasHero, T);

    const [background, avatars] = await Promise.all([
      loadBackgroundImage(data.backgroundUrl),
      v.flags.showAvatars ? loadAvatars(entries.map((entry) => entry.avatarUrl ?? null)) : new Map(),
    ]);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    paintBackground(ctx, { width, height, image: background, colors: v.colors });
    paintEdgeScrims(ctx, {
      width,
      height,
      top: T.padding + T.headerHeight,
      bottom: T.footerHeight ? T.footerHeight + T.padding : T.padding,
      colors: v.colors,
    });
    drawHeader(ctx, {
      v,
      fonts,
      width,
      guildName: data.guildName,
      page: data.page,
      pages: data.pages,
      headline: data.headline,
    });

    let y = T.padding + T.headerHeight;

    if (!entries.length) {
      drawEmptyBlock(ctx, { v, fonts, width, y });
    } else {
      if (hasHero) {
        drawHeroRow(ctx, {
          v,
          fonts,
          width,
          y,
          entry: entries[0],
          avatar: avatars.get(entries[0].avatarUrl ?? '') ?? null,
        });
        y += T.heroHeight + T.rowGap;
      }

      for (const entry of rows) {
        drawRow(ctx, { v, fonts, width, y, entry, avatar: avatars.get(entry.avatarUrl ?? '') ?? null });
        y += T.rowHeight + T.rowGap;
      }
    }

    if (v.flags.showFooter) {
      drawFooter(ctx, { v, fonts, width, height, total: data.total, pageSize: data.pageSize });
    }

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
