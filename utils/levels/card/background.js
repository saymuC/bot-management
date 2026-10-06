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
const { resolveVisual, withAlpha } = require('./visual');

/** Paleta do tema padrão, para quem chama sem passar tema. */
const DEFAULT_COLORS = resolveVisual(undefined).colors;

/** @typedef {import('@napi-rs/canvas').SKRSContext2D} Ctx */
/** @typedef {import('@napi-rs/canvas').Image} CanvasImage */

/**
 * Uma hora por URL. O fundo é uma escolha de configuração, não conteúdo vivo:
 * não vale bater no host a cada `/top`, e uma hora é curto o bastante para uma
 * troca de imagem aparecer sem ninguém reiniciar o bot.
 */
const BACKGROUND_TTL_MS = 60 * 60 * 1000;
const BACKGROUND_MAX_ENTRIES = 24;
const MAX_BACKGROUND_SIDE = 8192;
const MAX_BACKGROUND_PIXELS = 16_000_000;

/** Reject unsupported or oversized images before handing bytes to the native decoder. */
function safeBackgroundImage(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  let width = 0;
  let height = 0;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    for (let pos = 8; pos + 12 <= bytes.length;) {
      const size = bytes.readUInt32BE(pos);
      if (size > bytes.length - pos - 12) return false;
      if (bytes.toString('ascii', pos + 4, pos + 8) === 'acTL') return false;
      pos += size + 12;
    }
  } else if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) && bytes.length >= 13) {
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
    let pos = 13 + (bytes[10] & 0x80 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    let frames = 0;
    while (pos < bytes.length) {
      const marker = bytes[pos++];
      if (marker === 0x3b) break;
      if (marker === 0x2c) {
        if (++frames > 1 || pos + 9 > bytes.length) return false;
        const packed = bytes[pos + 8];
        pos += 9 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
        if (pos >= bytes.length) return false;
        pos += 1; // LZW minimum code size
      } else if (marker === 0x21) {
        pos += 1; // extension label
      } else return false;
      while (pos < bytes.length) {
        const size = bytes[pos++];
        if (!size) break;
        pos += size;
      }
    }
    if (frames !== 1 || bytes[pos - 1] !== 0x3b) return false;
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.length < 30) return false;
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X') {
      if (bytes[20] & 0x02) return false;
      width = bytes.readUIntLE(24, 3) + 1;
      height = bytes.readUIntLE(27, 3) + 1;
    } else if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let pos = 2; pos + 4 <= bytes.length;) {
      if (bytes[pos] !== 0xff) return false;
      const marker = bytes[pos + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const size = bytes.readUInt16BE(pos + 2);
      if (size < 2 || pos + 2 + size > bytes.length) return false;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (size < 7) return false;
        height = bytes.readUInt16BE(pos + 5);
        width = bytes.readUInt16BE(pos + 7);
        break;
      }
      pos += size + 2;
    }
  }
  return width > 0 && height > 0 && width <= MAX_BACKGROUND_SIDE && height <= MAX_BACKGROUND_SIDE && width * height <= MAX_BACKGROUND_PIXELS;
}

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
    if (!safeBackgroundImage(result.bytes)) return backgroundCache.set(url, null);
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
 * As três paradas do degradê vêm do preset do tema: é o que faz o fundo desenhado
 * acompanhar a paleta escolhida em vez de ser sempre grafite.
 *
 * @param {Ctx} ctx
 * @param {number} width
 * @param {number} height
 * @param {typeof DEFAULT_COLORS} [colors]
 */
function drawGeneratedBackground(ctx, width, height, colors = DEFAULT_COLORS) {
  const [from, middle, to] = colors.gradient;
  const gradient = ctx.createLinearGradient(0, 0, width * 0.35, height);
  gradient.addColorStop(0, from);
  gradient.addColorStop(0.55, middle);
  gradient.addColorStop(1, to);
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
 * @param {{ width: number, height: number, image?: CanvasImage|null, colors?: typeof DEFAULT_COLORS }} options
 */
function paintBackground(ctx, { width, height, image, colors = DEFAULT_COLORS }) {
  ctx.fillStyle = colors.base;
  ctx.fillRect(0, 0, width, height);

  if (image && image.width > 0 && image.height > 0) {
    // "Cover": a escala é a maior das duas, e o excedente é centralizado e cortado.
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    drawGeneratedBackground(ctx, width, height, colors);
  }

  ctx.fillStyle = colors.veil;
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
 * @param {{ width: number, height: number, top: number, bottom: number, colors?: typeof DEFAULT_COLORS }} options
 */
function paintEdgeScrims(ctx, { width, height, top, bottom, colors = DEFAULT_COLORS }) {
  const transparent = withAlpha(colors.base, 0);

  if (top > 0) {
    const gradient = ctx.createLinearGradient(0, 0, 0, top);
    gradient.addColorStop(0, colors.scrim);
    gradient.addColorStop(1, transparent);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, top);
  }

  if (bottom > 0) {
    const gradient = ctx.createLinearGradient(0, height - bottom, 0, height);
    gradient.addColorStop(0, transparent);
    gradient.addColorStop(1, colors.scrim);
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
