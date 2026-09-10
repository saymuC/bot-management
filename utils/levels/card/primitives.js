// @ts-check
/**
 * Primitivas de desenho do card: retângulo arredondado, recorte circular, barra
 * de progresso, texto que cabe e avatar.
 *
 * Nada aqui sabe o que é XP ou ranking — recebe coordenadas e devolve pixels.
 * É o que deixa o `/top` e o `/rank` compartilharem o traço sem um copiar o
 * outro, e o que faz esta parte ser testável sem montar uma página inteira.
 */

const { BAR, COLORS } = require('./theme');

/** @typedef {import('@napi-rs/canvas').SKRSContext2D} Ctx */
/** @typedef {ReturnType<Ctx['createLinearGradient']>} Gradient */

/**
 * Caminho de um retângulo arredondado.
 *
 * Feito com `arcTo` em vez de `ctx.roundRect` porque o método nativo não existe
 * em toda versão do `@napi-rs/canvas`, e um erro aqui derrubaria a imagem toda.
 *
 * @param {Ctx} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * Retângulo arredondado preenchido, com contorno opcional.
 *
 * @param {Ctx} ctx
 * @param {{ x: number, y: number, width: number, height: number, radius: number, fill?: string|Gradient, stroke?: string }} options
 */
function fillRoundRect(ctx, { x, y, width, height, radius, fill, stroke }) {
  roundRectPath(ctx, x, y, width, height, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/**
 * Recorta um círculo. Quem chama é responsável pelo `save`/`restore` — o recorte
 * não se desfaz sozinho e vazaria para o resto do desenho.
 *
 * @param {Ctx} ctx
 */
function clipCircle(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
}

/**
 * Texto cortado com `…` para caber na largura.
 *
 * Corta por busca binária porque medir caractere a caractere num nome de 32
 * caracteres é barato, mas isto roda dez vezes por página e o ganho é de graça.
 * A fonte tem de estar aplicada no contexto antes da chamada: a medição depende
 * dela.
 *
 * @param {Ctx} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
function fitText(ctx, text, maxWidth) {
  const value = String(text ?? '');
  if (maxWidth <= 0) return '';
  if (ctx.measureText(value).width <= maxWidth) return value;

  const ellipsis = '…';
  if (ctx.measureText(ellipsis).width > maxWidth) return '';

  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(value.slice(0, mid) + ellipsis).width <= maxWidth) low = mid;
    else high = mid - 1;
  }

  return value.slice(0, low) + ellipsis;
}

/**
 * Barra de progresso arredondada.
 *
 * O trilho é sempre desenhado inteiro e o preenchimento por cima, para 0% ficar
 * visível como "vazio" em vez de virar um buraco no layout. Preenchimento com
 * largura menor que a altura é forçado à altura: um sliver de 2 px arredondado
 * some, e "quase nada" tem de aparecer diferente de "nada".
 *
 * @param {Ctx} ctx
 * @param {{ x: number, y: number, width: number, height?: number, percent: number, track?: string, from?: string, to?: string }} options
 */
function drawBar(ctx, { x, y, width, height = BAR.height, percent, track, from, to }) {
  fillRoundRect(ctx, { x, y, width, height, radius: height / 2, fill: track ?? COLORS.track });

  const ratio = Math.max(0, Math.min(1, Number.isFinite(percent) ? percent : 0));
  if (ratio <= 0) return;

  const filled = Math.max(height, Math.round(width * ratio));
  const gradient = ctx.createLinearGradient(x, y, x + filled, y);
  gradient.addColorStop(0, from ?? COLORS.barFrom);
  gradient.addColorStop(1, to ?? COLORS.barTo);

  fillRoundRect(ctx, { x, y, width: Math.min(width, filled), height, radius: height / 2, fill: gradient });
}

/**
 * Avatar circular, ou um círculo com a inicial quando a imagem não veio.
 *
 * A reserva não é enfeite: o CDN do Discord falha, o membro pode não ter avatar
 * e uma linha sem imagem desalinharia a lista inteira. Melhor uma inicial do que
 * um furo — e muito melhor do que uma exceção no meio do render.
 *
 * @param {Ctx} ctx
 * @param {{ image: import('@napi-rs/canvas').Image|null, cx: number, cy: number, radius: number, initial?: string, family: string, ring?: string, fallbackFill?: string, fallbackColor?: string }} options
 */
function drawAvatar(ctx, { image, cx, cy, radius, initial, family, ring, fallbackFill, fallbackColor }) {
  ctx.save();
  clipCircle(ctx, cx, cy, radius);

  if (image) {
    // Recorte quadrado no centro: avatar do Discord já é quadrado, mas um fundo
    // remoto ou uma imagem estranha não estica se o cálculo respeitar o menor lado.
    const side = Math.min(image.width, image.height) || 1;
    const sx = (image.width - side) / 2;
    const sy = (image.height - side) / 2;
    ctx.drawImage(image, sx, sy, side, side, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = fallbackFill ?? 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

    ctx.fillStyle = fallbackColor ?? COLORS.muted;
    ctx.font = `bold ${Math.round(radius * 1.05)}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(initial ?? '?').slice(0, 1).toUpperCase(), cx, cy + radius * 0.04);
  }

  ctx.restore();

  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
}

/**
 * Primeira letra utilizável de um nome, para a reserva do avatar.
 * @param {string} name
 */
function initialOf(name) {
  const match = String(name ?? '').match(/\p{L}|\p{N}/u);
  return match ? match[0].toUpperCase() : '?';
}

module.exports = { roundRectPath, fillRoundRect, clipCircle, fitText, drawBar, drawAvatar, initialOf };
