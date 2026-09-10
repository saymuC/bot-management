// @ts-check
/**
 * A imagem do `/rank`: um card único com avatar, nível, barra e posição.
 *
 * Mesmo contrato do ranking — `Buffer` ou `null`, nunca lança — e o mesmo fundo,
 * para os dois comandos parecerem parte da mesma coisa. O card destacado do
 * primeiro lugar no `/top` é deliberadamente parecido com este: é o mesmo dado.
 *
 * Sem cache aqui: a chave seria "membro + XP exato", que muda a cada mensagem que
 * a pessoa manda, e o `/rank` é um render só, não dez.
 */

const { createCanvas } = require('@napi-rs/canvas');
const { fontStacks } = require('../../canvasFonts');
const { xpProgress, MAX_LEVEL } = require('../formula');
const { formatXp } = require('../leaderboard');
const { RANK, BAR, COLORS } = require('./theme');
const { fillRoundRect, fitText, drawBar, drawAvatar, initialOf } = require('./primitives');
const { paintBackground, loadBackgroundImage } = require('./background');
const { loadAvatar } = require('./avatars');

/**
 * @typedef {Object} RankCardData
 * @property {string} name
 * @property {string|null} [avatarUrl]
 * @property {number} totalXp
 * @property {number|null} [position] posição no ranking, ou null para quem ainda não pontuou
 * @property {number} participants
 * @property {string|null} [headline]
 * @property {string|null} [backgroundUrl]
 */

/**
 * PNG do card de progresso, ou `null` quando não é possível desenhar.
 *
 * @param {RankCardData} data
 * @returns {Promise<Buffer|null>}
 */
async function renderRankCard(data) {
  const families = fontStacks();
  if (!families) return null;

  try {
    const width = RANK.width;
    const height = RANK.height;
    const progress = xpProgress(data.totalXp);

    const [background, avatar] = await Promise.all([
      loadBackgroundImage(data.backgroundUrl),
      loadAvatar(data.avatarUrl ?? null),
    ]);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    paintBackground(ctx, { width, height, image: background });

    const x = RANK.padding;
    const y = RANK.padding;
    const cardWidth = width - RANK.padding * 2;
    const cardHeight = height - RANK.padding * 2;

    fillRoundRect(ctx, {
      x,
      y,
      width: cardWidth,
      height: cardHeight,
      radius: RANK.radius,
      fill: COLORS.panel,
      stroke: COLORS.panelStroke,
    });

    const avatarCx = x + RANK.inner + RANK.avatarRadius;
    drawAvatar(ctx, {
      image: avatar,
      cx: avatarCx,
      cy: y + cardHeight / 2,
      radius: RANK.avatarRadius,
      initial: initialOf(data.name),
      family: families.body,
      ring: 'rgba(255, 255, 255, 0.16)',
    });

    const textLeft = avatarCx + RANK.avatarRadius + RANK.inner;
    const textRight = x + cardWidth - RANK.inner;

    ctx.textBaseline = 'alphabetic';

    // O XP total sai primeiro para a largura dele poder limitar o nome: nome longo
    // corta com `…` em vez de passar por cima do número.
    ctx.textAlign = 'right';
    ctx.font = `bold 26px ${families.body}`;
    ctx.fillStyle = COLORS.text;
    const xpLabel = `${formatXp(progress.totalXp)} XP`;
    ctx.fillText(xpLabel, textRight, y + 74);
    const xpWidth = ctx.measureText(xpLabel).width;

    ctx.font = `16px ${families.body}`;
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(
      data.position ? `#${data.position} de ${formatXp(data.participants)}` : 'ainda sem pontuação',
      textRight,
      y + 108
    );

    ctx.textAlign = 'left';
    ctx.font = `bold 38px ${families.display}`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(fitText(ctx, data.name, textRight - textLeft - xpWidth - 28), textLeft, y + 76);

    ctx.font = `20px ${families.body}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`Nível ${progress.level}`, textLeft, y + 110);

    drawBar(ctx, {
      x: textLeft,
      y: y + 132,
      width: textRight - textLeft,
      height: BAR.rankHeight,
      percent: progress.percent,
    });

    ctx.font = `16px ${families.body}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(
      progress.level >= MAX_LEVEL
        ? `Nível máximo (${MAX_LEVEL}) alcançado`
        : `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)} XP para o nível ${progress.level + 1}`,
      textLeft,
      y + 176
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.faint;
    ctx.fillText(`${Math.round(progress.percent * 100)}%`, textRight, y + 176);

    if (data.headline) {
      ctx.textAlign = 'left';
      ctx.font = `15px ${families.body}`;
      ctx.fillStyle = COLORS.faint;
      ctx.fillText(fitText(ctx, data.headline, cardWidth - RANK.inner * 2), textLeft, y + 30);
    }

    return canvas.toBuffer('image/png');
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[levels] falha ao desenhar o card de progresso:', motivo);
    return null;
  }
}

module.exports = { renderRankCard };
