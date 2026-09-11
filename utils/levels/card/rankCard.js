// @ts-check
/**
 * A imagem do `/rank`: um card único com avatar, nível, barra e posição.
 *
 * Mesmo contrato do ranking — `Buffer` ou `null`, nunca lança — e o mesmo fundo,
 * para os dois comandos parecerem parte da mesma coisa. O card destacado do
 * primeiro lugar no `/top` é deliberadamente parecido com este: é o mesmo dado.
 *
 * A composição é em duas zonas: uma placa escura à esquerda com o avatar e o selo
 * do nível, e o papel claro à direita com os números. Um card só, de uma cor só,
 * fica sem hierarquia — é um retângulo com texto dentro, e foi exatamente essa a
 * crítica ao primeiro desenho.
 *
 * Sem cache aqui: a chave seria "membro + XP exato", que muda a cada mensagem que
 * a pessoa manda, e o `/rank` é um render só, não dez.
 */

const { createCanvas } = require('@napi-rs/canvas');
const { fontStacks } = require('../../canvasFonts');
const { xpProgress, MAX_LEVEL } = require('../formula');
const { formatXp } = require('../leaderboard');
const { resolveVisual } = require('./visual');
const {
  fillRoundRect,
  roundRectPath,
  drawHatch,
  drawBadge,
  drawPill,
  fitText,
  drawBar,
  drawAvatar,
  initialOf,
} = require('./primitives');
const { paintBackground, loadBackgroundImage } = require('./background');
const { loadAvatar } = require('./avatars');

/** Largura da placa escura da esquerda, onde fica o avatar. */
const PLATE_WIDTH = 300;

/**
 * @typedef {Object} RankCardData
 * @property {string} name
 * @property {string|null} [avatarUrl]
 * @property {number} totalXp
 * @property {number|null} [position] posição no ranking, ou null para quem ainda não pontuou
 * @property {number} participants
 * @property {string|null} [headline]
 * @property {string|null} [backgroundUrl]
 * @property {unknown} [theme] aparência configurada; ausente = tema padrão
 */

/**
 * PNG do card de progresso, ou `null` quando não é possível desenhar.
 *
 * @param {RankCardData} data
 * @returns {Promise<Buffer|null>}
 */
async function renderRankCard(data) {
  const fonts = fontStacks();
  if (!fonts) return null;

  try {
    const v = resolveVisual(data.theme);
    const { colors, flags, rank: RANK, bar: BAR } = v;

    const width = RANK.width;
    const height = RANK.height;
    const progress = xpProgress(data.totalXp);

    const [background, avatar] = await Promise.all([
      loadBackgroundImage(data.backgroundUrl),
      flags.showAvatars ? loadAvatar(data.avatarUrl ?? null) : null,
    ]);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    paintBackground(ctx, { width, height, image: background, colors });

    const x = RANK.padding;
    const y = RANK.padding;
    const cardWidth = width - RANK.padding * 2;
    const cardHeight = height - RANK.padding * 2;
    const centerY = y + cardHeight / 2;

    fillRoundRect(ctx, {
      x,
      y,
      width: cardWidth,
      height: cardHeight,
      radius: RANK.radius,
      fill: colors.hero,
      stroke: colors.heroStroke,
      shadow: flags.showShadow ? { color: 'rgba(0, 0, 0, 0.5)', blur: 22, offsetY: 7 } : undefined,
    });

    // A placa vive dentro do recorte do cartão, senão vaza os cantos arredondados.
    ctx.save();
    roundRectPath(ctx, x, y, cardWidth, cardHeight, RANK.radius);
    ctx.clip();

    const plate = ctx.createLinearGradient(x, y, x + PLATE_WIDTH, y + cardHeight);
    plate.addColorStop(0, colors.barFrom);
    plate.addColorStop(1, colors.barTo);
    ctx.fillStyle = plate;
    ctx.fillRect(x, y, PLATE_WIDTH, cardHeight);

    // Hachura e brilho atrás do avatar: sem isto a placa é um retângulo chapado.
    if (flags.showTexture) {
      drawHatch(ctx, { x, y, width: PLATE_WIDTH, height: cardHeight, color: colors.plateHatch, gap: 16 });
    }

    const glow = ctx.createRadialGradient(
      x + PLATE_WIDTH / 2,
      centerY,
      0,
      x + PLATE_WIDTH / 2,
      centerY,
      RANK.avatarRadius * 1.9
    );
    glow.addColorStop(0, colors.plateGlow);
    glow.addColorStop(1, colors.plateTransparent);
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, PLATE_WIDTH, cardHeight);

    // Fio na junta das duas zonas, para a troca de cor não parecer um corte cru.
    ctx.fillStyle = colors.seam;
    ctx.fillRect(x + PLATE_WIDTH, y, 2, cardHeight);

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const avatarCx = x + PLATE_WIDTH / 2;
    if (flags.showAvatars) {
      drawAvatar(ctx, {
        image: avatar,
        cx: avatarCx,
        cy: centerY,
        radius: RANK.avatarRadius,
        initial: initialOf(data.name),
        family: fonts.body,
        ring: colors.plateRing,
        fallbackFill: colors.plateGlow,
        fallbackColor: colors.plateMuted,
      });
    }

    // Selo do nível grudado no avatar: é o número que a pessoa quer ver primeiro, e
    // sobre a placa escura ele aparece sem competir com o nome. Sem avatar ele vira
    // o assunto da placa e ocupa o centro dela — encolhido num canto, pareceria um
    // resto de um elemento que foi removido.
    const badgeRadius = flags.showAvatars ? RANK.badgeRadius : RANK.badgeRadius * 1.9;
    drawBadge(ctx, {
      text: String(progress.level),
      cx: avatarCx + (flags.showAvatars ? RANK.avatarRadius * 0.72 : 0),
      cy: centerY + (flags.showAvatars ? RANK.avatarRadius * 0.72 : 0),
      radius: badgeRadius,
      font: `${fonts.weight}${Math.round(badgeRadius * (progress.level >= 100 ? 0.7 : 0.88))}px ${fonts.strong}`,
      fill: colors.ink,
      background: colors.hero,
      stroke: colors.barFrom,
    });

    const textLeft = x + PLATE_WIDTH + RANK.inner;
    const textRight = x + cardWidth - RANK.inner;

    const positionPill = drawPill(ctx, {
      text: data.position ? `#${data.position} de ${formatXp(data.participants)}` : 'sem pontuação',
      right: textRight,
      centerY: y + 44,
      font: `${fonts.weight}19px ${fonts.strong}`,
      fill: colors.hero,
      background: colors.ink,
      height: 36,
      paddingX: 16,
    });

    if (data.headline) {
      ctx.font = `17px ${fonts.body}`;
      ctx.fillStyle = colors.inkFaint;
      ctx.fillText(
        fitText(ctx, data.headline, textRight - textLeft - positionPill - 20),
        textLeft,
        y + 50
      );
    }

    // O XP total sai antes do nome para a largura dele poder limitar o nome: nome
    // longo corta com `…` em vez de passar por cima do número.
    ctx.textAlign = 'right';
    ctx.font = `${fonts.weight}32px ${fonts.strong}`;
    ctx.fillStyle = colors.ink;
    const xpLabel = `${formatXp(progress.totalXp)} XP`;
    ctx.fillText(xpLabel, textRight, y + 112);
    const xpWidth = ctx.measureText(xpLabel).width;

    ctx.font = `18px ${fonts.body}`;
    ctx.fillStyle = colors.inkFaint;
    ctx.fillText(
      progress.xpForNextLevel > 0
        ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
        : 'nível máximo',
      textRight,
      y + 148
    );

    ctx.textAlign = 'left';
    ctx.font = `${fonts.weight}42px ${fonts.strong}`;
    ctx.fillStyle = colors.ink;
    ctx.fillText(fitText(ctx, data.name, textRight - textLeft - xpWidth - 28), textLeft, y + 112);

    ctx.font = `${fonts.weight}22px ${fonts.strong}`;
    ctx.fillStyle = colors.inkMuted;
    ctx.fillText(`Nível ${progress.level}`, textLeft, y + 148);

    if (flags.showBars) {
      drawBar(ctx, {
        x: textLeft,
        y: y + 168,
        width: textRight - textLeft,
        height: BAR.rankHeight,
        percent: progress.percent,
        track: colors.track,
        from: colors.barFrom,
        to: colors.barTo,
      });
    }

    ctx.font = `18px ${fonts.body}`;
    ctx.fillStyle = colors.inkMuted;
    ctx.fillText(
      progress.level >= MAX_LEVEL
        ? `Nível máximo (${MAX_LEVEL}) alcançado`
        : `faltam ${formatXp(Math.max(0, progress.xpForNextLevel - progress.xpIntoLevel))} XP para o nível ${progress.level + 1}`,
      textLeft,
      y + 220
    );

    ctx.textAlign = 'right';
    ctx.font = `${fonts.weight}18px ${fonts.strong}`;
    ctx.fillStyle = colors.ink;
    ctx.fillText(`${Math.round(progress.percent * 100)}%`, textRight, y + 220);
    ctx.textAlign = 'left';

    ctx.font = `16px ${fonts.body}`;
    ctx.fillStyle = colors.inkFaint;
    ctx.fillText(`${formatXp(data.participants)} participante(s) no ranking`, textLeft, y + 254);

    return canvas.toBuffer('image/png');
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[levels] falha ao desenhar o card de progresso:', motivo);
    return null;
  }
}

module.exports = { renderRankCard };
