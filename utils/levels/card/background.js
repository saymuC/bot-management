// @ts-check
/**
 * Fundo das imagens do ranking.
 *
 * Dois caminhos: o fundo desenhado (sempre disponível) e a imagem que o servidor
 * configurou por URL. O remoto é uma conveniência, não uma dependência — se o
 * host de terceiro estiver fora, lento ou devolvendo HTML, o `/top` continua
 * saindo com o fundo desenhado e ninguém fica sabendo.
 *
 * Por cima de qualquer um dos dois vai o mesmo véu escuro: é o que garante que o
 * texto branco seja legível mesmo sobre uma imagem clara que o admin escolheu.
 */

const { loadImage } = require('@napi-rs/canvas');
const { fetchRemoteImage } = require('../../remoteImage');
const { MAX_BACKGROUND_BYTES } = require('../../../config/levels');
const { createCache } = require('./cache');
const { COLORS } = require('./theme');

/** @typedef {import('@napi-rs/canvas').SKRSContext2D} Ctx */
/** @typedef {import('@napi-rs/canvas').Image} CanvasImage */

/**
 * Uma hora por URL. O fundo é uma escolha de configuração, não conteúdo vivo:
 * não vale bater no host a cada `/top`, e uma hora é curto o bastante para uma
 * troca de imagem aparecer sem ninguém reiniciar o bot.
 */
const BACKGROUND_TTL_MS = 60 * 60 * 1000;
const BACKGROUND_MAX_ENTRIES = 24;

/** @type {ReturnType<typeof createCache<CanvasImage|null>>} */
const backgroundCache = createCache({ ttlMs: BACKGROUND_TTL_MS, max: BACKGROUND_MAX_ENTRIES });

/**
 * Baixa e decodifica o fundo remoto, ou devolve `null`.
 *
 * O `null` também é guardado em cache, de propósito: sem isso, uma URL que dá 404
 * seria baixada de novo em cada página de cada `/top`, o que é justamente o
 * comportamento que um erro de digitação na config não deveria provocar.
 *
 * @param {string|null|undefined} url
 * @param {{ fetcher?: typeof fetchRemoteImage, decoder?: typeof loadImage }} [deps] injeção para teste
 * @returns {Promise<CanvasImage|null>}
 */
async function loadBackgroundImage(url, deps = {}) {
  if (!url) return null;

  const cached = backgroundCache.get(url);
  if (cached !== undefined) return cached;

  const fetcher = deps.fetcher ?? fetchRemoteImage;
  const decoder = deps.decoder ?? loadImage;

  try {
    const result = await fetcher(url, { maxBytes: MAX_BACKGROUND_BYTES });
    if (!result.ok) return backgroundCache.set(url, null);
    return backgroundCache.set(url, await decoder(result.bytes));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[levels] falha ao carregar o fundo do ranking:', motivo);
    return backgroundCache.set(url, null);
  }
}

/**
 * Ruído determinístico, sem `Math.random`.
 *
 * Aleatório de verdade faria a mesma página sair diferente a cada render, o que
 * atrapalharia tanto o cache visual do Discord quanto qualquer comparação em
 * teste. O hash abaixo é barato e estável.
 *
 * @param {number} n
 * @returns {number} 0 a 1
 */
function noise(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Fundo desenhado: gradiente escuro, textura em pontos e vinheta.
 *
 * A textura existe porque um gradiente puro em PNG de 1000 px fica com faixas
 * visíveis (banding); os pontos quebram a transição sem virar sujeira.
 *
 * @param {Ctx} ctx
 * @param {number} width
 * @param {number} height
 */
function drawGeneratedBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width * 0.35, height);
  gradient.addColorStop(0, '#191b21');
  gradient.addColorStop(0.55, '#12131a');
  gradient.addColorStop(1, COLORS.base);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Brilho suave no alto, para o cabeçalho não parecer colado num fundo chapado.
  const glow = ctx.createRadialGradient(width * 0.78, -height * 0.1, 0, width * 0.78, -height * 0.1, height * 0.7);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.055)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const dots = Math.round((width * height) / 5200);
  for (let i = 0; i < dots; i += 1) {
    const x = noise(i * 3 + 1) * width;
    const y = noise(i * 3 + 2) * height;
    const alpha = 0.012 + noise(i * 3 + 3) * 0.032;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.25,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.78
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Pinta o fundo inteiro: a imagem configurada (cobrindo a área sem distorcer) ou
 * o fundo desenhado, e o véu por cima nos dois casos.
 *
 * @param {Ctx} ctx
 * @param {{ width: number, height: number, image?: CanvasImage|null }} options
 */
function paintBackground(ctx, { width, height, image }) {
  ctx.fillStyle = COLORS.base;
  ctx.fillRect(0, 0, width, height);

  if (image && image.width > 0 && image.height > 0) {
    // "Cover": a escala é a maior das duas, e o excedente é centralizado e cortado.
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    drawGeneratedBackground(ctx, width, height);
  }

  ctx.fillStyle = COLORS.veil;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Escurece as duas pontas da imagem, atrás do cabeçalho e do rodapé.
 *
 * Chamado depois de `paintBackground` e antes de qualquer texto. Sem isto, o véu
 * teria de ser denso o bastante para o pior fundo possível — e aí todo fundo bom
 * pagaria por isso.
 *
 * @param {Ctx} ctx
 * @param {{ width: number, height: number, top: number, bottom: number }} options
 */
function paintEdgeScrims(ctx, { width, height, top, bottom }) {
  if (top > 0) {
    const gradient = ctx.createLinearGradient(0, 0, 0, top);
    gradient.addColorStop(0, COLORS.scrim);
    gradient.addColorStop(1, 'rgba(9, 10, 13, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, top);
  }

  if (bottom > 0) {
    const gradient = ctx.createLinearGradient(0, height - bottom, 0, height);
    gradient.addColorStop(0, 'rgba(9, 10, 13, 0)');
    gradient.addColorStop(1, COLORS.scrim);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height - bottom, width, bottom);
  }
}

module.exports = {
  BACKGROUND_TTL_MS,
  BACKGROUND_MAX_ENTRIES,
  backgroundCache,
  noise,
  loadBackgroundImage,
  drawGeneratedBackground,
  paintBackground,
  paintEdgeScrims,
};
