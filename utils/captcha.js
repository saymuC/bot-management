/**
 * Geração de captcha em imagem para a verificação de entrada.
 *
 * O objetivo é exigir uma ação que um bot de auto-join não consiga repetir só
 * clicando: ler um código distorcido e digitá-lo. Por isso o código nunca
 * aparece em texto na mensagem — só dentro do PNG, com ruído, rotação por
 * caractere e uma distorção de onda aplicada nos pixels.
 *
 * Não depende de nada do Discord: recebe/devolve dados puros, o que deixa o
 * gerador testável isolado do bot.
 */

const { randomInt } = require('node:crypto');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { verify: verifyConfig } = require('../config/settings');

/**
 * Alfabeto sem caracteres ambíguos na tela: fora 0/O, 1/I/L, 2/Z, 5/S, 8/B, 6/G.
 * Evita a pessoa errar por causa da fonte, não por causa do captcha.
 */
const ALPHABET = 'ACDEFHJKMNPQRTUVWXY34679';

/** Fontes preferidas, na ordem; caímos na primeira que o sistema tiver. */
const FONT_CANDIDATES = ['DejaVu Sans', 'Liberation Sans', 'Arial', 'Helvetica', 'Verdana', 'Noto Sans', 'sans-serif'];

/** Paleta clara para o texto, sobre o fundo escuro do tema do Discord. */
const TEXT_COLORS = ['#ffffff', '#c9d1ff', '#ffd9a8', '#b9f6ca', '#ffc4dd', '#a8e6ff'];

const BACKGROUND = '#1e1f22';
// As linhas passam por cima das letras: opacidade mais alta atrapalha o recorte
// automático dos glifos, mas o olho humano ainda separa linha de caractere.
const LINE_COLOR = 'rgba(255, 255, 255, 0.30)';
const DOT_COLOR = 'rgba(255, 255, 255, 0.14)';

/**
 * Família de fonte disponível no sistema.
 *
 * Em hosts Linux enxutos (containers sem pacote de fontes) nenhuma família é
 * registrada e o texto sairia em branco, então isso é checado na inicialização.
 */
function resolveFontFamily() {
  const available = new Set(GlobalFonts.families.map((entry) => entry.family));
  return FONT_CANDIDATES.find((family) => available.has(family)) ?? null;
}

/**
 * @returns {{ ok: true, family: string }|{ ok: false, reason: string }}
 * Usado no boot para avisar cedo em vez de gerar captchas ilegíveis.
 */
function checkCaptchaSupport() {
  const family = resolveFontFamily();
  if (family) return { ok: true, family };
  return {
    ok: false,
    reason:
      'Nenhuma fonte do sistema encontrada — o captcha sairia em branco. ' +
      'Instale um pacote de fontes no host (ex.: `apt-get install fonts-dejavu-core`).',
  };
}

/** Código aleatório usando CSPRNG (não Math.random: é um segredo de curta duração). */
function generateCode(length = verifyConfig.codeLength) {
  let code = '';
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Float aleatório em [min, max) a partir do CSPRNG. */
const randFloat = (min, max) => min + (randomInt(0, 10_000) / 10_000) * (max - min);

/** Linhas curvas atravessando a imagem, para quebrar o contorno das letras. */
function drawNoiseLines(ctx, width, height, count) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE_COLOR;
  for (let i = 0; i < count; i += 1) {
    ctx.beginPath();
    ctx.moveTo(randFloat(0, width * 0.2), randFloat(0, height));
    ctx.bezierCurveTo(
      randFloat(0, width),
      randFloat(0, height),
      randFloat(0, width),
      randFloat(0, height),
      randFloat(width * 0.8, width),
      randFloat(0, height)
    );
    ctx.stroke();
  }
}

/** Pontilhado de fundo: atrapalha binarização automática da imagem. */
function drawNoiseDots(ctx, width, height, count) {
  ctx.fillStyle = DOT_COLOR;
  for (let i = 0; i < count; i += 1) {
    ctx.beginPath();
    ctx.arc(randFloat(0, width), randFloat(0, height), randFloat(0.8, 2.2), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Desenha os caracteres espaçados, cada um com rotação, escala e cor próprias. */
function drawCharacters(ctx, code, width, height, family) {
  const slot = width / (code.length + 1);

  for (let i = 0; i < code.length; i += 1) {
    const size = randFloat(48, 62);
    ctx.save();
    ctx.translate(slot * (i + 1) + randFloat(-6, 6), height / 2 + randFloat(-8, 8));
    ctx.rotate(randFloat(-0.38, 0.38));
    ctx.font = `bold ${size.toFixed(0)}px "${family}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEXT_COLORS[randomInt(TEXT_COLORS.length)];
    ctx.fillText(code[i], 0, 0);
    ctx.restore();
  }
}

/**
 * Distorção de onda deslocando cada linha e coluna de pixels por um seno.
 *
 * É o que impede recortar o glifo e comparar com um gabarito: as letras deixam
 * de ser retas mesmo depois de remover o ruído.
 */
function applyWaveDistortion(ctx, width, height) {
  const source = ctx.getImageData(0, 0, width, height);
  const output = ctx.createImageData(width, height);

  // Amplitude baixa e período longo: o suficiente para curvar as letras sem
  // picotá-las. Períodos curtos viram zigue-zague e tornam o código ilegível.
  const amplitudeX = randFloat(3, 5);
  const amplitudeY = randFloat(2, 4);
  const periodX = randFloat(90, 140);
  const periodY = randFloat(140, 220);
  const phaseX = randFloat(0, Math.PI * 2);
  const phaseY = randFloat(0, Math.PI * 2);

  for (let y = 0; y < height; y += 1) {
    const shiftX = Math.round(amplitudeX * Math.sin((y / periodX) * Math.PI * 2 + phaseX));
    for (let x = 0; x < width; x += 1) {
      const shiftY = Math.round(amplitudeY * Math.sin((x / periodY) * Math.PI * 2 + phaseY));
      // Clamp mantém a borda repetida em vez de deixar pixels transparentes.
      const srcX = Math.min(width - 1, Math.max(0, x + shiftX));
      const srcY = Math.min(height - 1, Math.max(0, y + shiftY));

      const to = (y * width + x) * 4;
      const from = (srcY * width + srcX) * 4;
      output.data[to] = source.data[from];
      output.data[to + 1] = source.data[from + 1];
      output.data[to + 2] = source.data[from + 2];
      output.data[to + 3] = source.data[from + 3];
    }
  }

  ctx.putImageData(output, 0, 0);
}

/**
 * Renderiza o PNG do captcha.
 *
 * @param {string} code código a desenhar.
 * @returns {Buffer|null} PNG, ou null se o host não tem fonte utilizável.
 */
function renderCaptcha(code) {
  const family = resolveFontFamily();
  if (!family) return null;

  const { imageWidth: width, imageHeight: height, noiseLines, noiseDots } = verifyConfig;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  drawNoiseDots(ctx, width, height, noiseDots);
  drawCharacters(ctx, code, width, height, family);
  drawNoiseLines(ctx, width, height, noiseLines);
  applyWaveDistortion(ctx, width, height);

  return canvas.toBuffer('image/png');
}

/**
 * Compara a resposta com o código, tolerando caixa e espaços.
 * A comparação não precisa ser de tempo constante: o código é de uso único,
 * expira em minutos e o número de tentativas é limitado.
 */
function matchesCode(answer, code) {
  const normalize = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();
  const clean = normalize(answer);
  return clean.length > 0 && clean === normalize(code);
}

module.exports = { ALPHABET, generateCode, renderCaptcha, matchesCode, checkCaptchaSupport };
