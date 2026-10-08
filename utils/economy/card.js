// @ts-check
const { createCanvas } = require('@napi-rs/canvas');
const { fontStacks } = require('../canvasFonts');
const { loadAvatar, loadAvatars } = require('../levels/card/avatars');
const { fillRoundRect, roundRectPath, drawAvatar, fitText, initialOf } = require('../levels/card/primitives');
const { formatMoney } = require('./formatter');

const WIDTH = 900;
const BACKDROP = '#18191e';
const TEXT = '#f6f7ff';
const MUTED = '#a2a4b5';
const STATUS = { online: '#32c88b', idle: '#f5bd4f', dnd: '#ed5961', offline: '#788091' };

/** @param {import('@napi-rs/canvas').SKRSContext2D} ctx @param {number} width @param {number} height */
function mountains(ctx, width, height) {
  const sky = ctx.createLinearGradient(0, 0, width, height);
  sky.addColorStop(0, '#232144');
  sky.addColorStop(0.58, '#4b4887');
  sky.addColorStop(1, '#7470b1');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  const moon = ctx.createRadialGradient(width * 0.86, height * 0.26, 4, width * 0.86, height * 0.26, height * 0.23);
  moon.addColorStop(0, '#aaa7f1'); moon.addColorStop(0.72, '#8885d2'); moon.addColorStop(1, 'rgba(136,133,210,0)');
  ctx.fillStyle = moon;
  ctx.beginPath(); ctx.arc(width * 0.86, height * 0.26, height * 0.23, 0, Math.PI * 2); ctx.fill();
  // Silhouettes at different depths; irregular ridges keep the landscape from looking like a zigzag.
  const ridges = [
    { color: '#484574', top: 0.46, points: [0.55, 0.57, 0.42, 0.61, 0.38, 0.5, 0.3, 0.54, 0.43, 0.63, 0.52] },
    { color: '#333154', top: 0.64, points: [0.66, 0.69, 0.55, 0.6, 0.46, 0.53, 0.4, 0.62, 0.57, 0.72, 0.65] },
    { color: '#28283f', top: 0.79, points: [0.77, 0.75, 0.82, 0.73, 0.76, 0.81, 0.72, 0.8, 0.75, 0.84, 0.79] },
  ];
  for (const ridge of ridges) {
    ctx.fillStyle = ridge.color;
    ctx.beginPath(); ctx.moveTo(0, height * ridge.top);
    ridge.points.forEach((y, index) => {
      const x = width * index / (ridge.points.length - 1);
      ctx.quadraticCurveTo(x - width / 30, height * y, x, height * y);
    });
    ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.fill();
  }
  const mist = ctx.createLinearGradient(0, height * 0.55, 0, height);
  mist.addColorStop(0, 'rgba(142,136,203,0)'); mist.addColorStop(1, 'rgba(19,20,36,0.36)');
  ctx.fillStyle = mist; ctx.fillRect(0, height * 0.55, width, height * 0.45);
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} ctx @param {number} x @param {number} y @param {number} width @param {number} height */
function drawLandscape(ctx, x, y, width, height) {
  ctx.save(); ctx.translate(x, y); ctx.scale(width / WIDTH, height / 245);
  mountains(ctx, WIDTH, 245);
  ctx.restore();
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} ctx @param {number} x @param {number} y @param {number} radius */
function coin(ctx, x, y, radius) {
  const gold = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
  gold.addColorStop(0, '#fff1a8'); gold.addColorStop(0.45, '#ffbd29'); gold.addColorStop(1, '#e77b08');
  ctx.fillStyle = gold;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffe783'; ctx.lineWidth = Math.max(3, radius * 0.14);
  ctx.beginPath(); ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffeb8a';
  ctx.beginPath(); ctx.moveTo(x, y - radius * 0.4); ctx.lineTo(x + radius * 0.38, y);
  ctx.lineTo(x, y + radius * 0.4); ctx.lineTo(x - radius * 0.38, y); ctx.closePath(); ctx.fill();
}

/** @param {import('@napi-rs/canvas').SKRSContext2D} ctx @param {NonNullable<ReturnType<typeof fontStacks>>} fonts @param {number} size */
function setFont(ctx, fonts, size) { ctx.font = `${fonts.weight}${size}px ${fonts.strong}`; }

/** @param {{ name: string, balance: number, position: number|null, avatarUrl?: string|null, bannerUrl?: string|null, status?: string|null, currencyName?: string }} data @returns {Promise<Buffer|null>} */
async function renderBalanceCard(data) {
  const fonts = fontStacks();
  if (!fonts) return null;
  try {
    const [avatar, banner] = await Promise.all([loadAvatar(data.avatarUrl), loadAvatar(data.bannerUrl)]);
    const canvas = createCanvas(WIDTH, 500);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = BACKDROP; ctx.fillRect(0, 0, WIDTH, 500);
    fillRoundRect(ctx, { x: 30, y: 50, width: 840, height: 400, radius: 36, fill: '#24252e' });
    ctx.save(); roundRectPath(ctx, 30, 50, 840, 400, 36); ctx.clip();
    if (banner) {
      const scale = Math.max(840 / banner.width, 225 / banner.height);
      const dw = banner.width * scale;
      const dh = banner.height * scale;
      ctx.drawImage(banner, 30 + (840 - dw) / 2, 50 + (225 - dh) / 2, dw, dh);
    } else drawLandscape(ctx, 30, 50, 840, 225);
    const shade = ctx.createLinearGradient(0, 50, 0, 275);
    shade.addColorStop(0, 'rgba(16,16,35,0.12)'); shade.addColorStop(1, 'rgba(16,16,35,0.5)');
    ctx.fillStyle = shade; ctx.fillRect(30, 50, 840, 225);
    ctx.fillStyle = '#24252e'; ctx.fillRect(30, 275, 840, 175);
    ctx.restore();
    drawAvatar(ctx, { image: avatar, cx: 177, cy: 205, radius: 92, initial: initialOf(data.name),
      family: fonts.strong, ring: '#30303a', fallbackFill: '#252630', fallbackColor: TEXT });
    if (data.status && STATUS[data.status]) {
      ctx.fillStyle = STATUS[data.status];
      ctx.beginPath(); ctx.arc(247, 272, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#24252e'; ctx.lineWidth = 6; ctx.stroke();
    }
    setFont(ctx, fonts, 52); ctx.fillStyle = TEXT;
    ctx.fillText(fitText(ctx, data.name, 550), 330, 218);
    coin(ctx, 122, 360, 39);
    setFont(ctx, fonts, 48); ctx.fillStyle = TEXT;
    ctx.fillText(fitText(ctx, formatMoney(data.balance), 275), 185, 357);
    ctx.font = `26px ${fonts.body}`; ctx.fillStyle = MUTED;
    ctx.fillText(fitText(ctx, data.currencyName ?? 'Moedas', 330), 185, 394);
    ctx.fillStyle = '#393a48'; ctx.fillRect(465, 310, 2, 100);
    setFont(ctx, fonts, 52); ctx.fillStyle = '#ffc342'; ctx.fillText('★', 535, 363);
    ctx.fillStyle = TEXT; ctx.fillText(fitText(ctx, data.position ? `#${data.position}` : '—', 245), 600, 357);
    ctx.font = `26px ${fonts.body}`; ctx.fillStyle = MUTED; ctx.fillText('Ranking', 602, 394);
    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('[economy] falha ao desenhar saldo:', err);
    return null;
  }
}

/** @param {{ entries: Array<{position: number, name: string, balance: number, avatarUrl?: string|null}>, page: number, pages: number, currencyName?: string }} data @returns {Promise<Buffer|null>} */
async function renderEconomyRanking(data) {
  const fonts = fontStacks();
  if (!fonts) return null;
  try {
    const avatars = await loadAvatars(data.entries.map((entry) => entry.avatarUrl));
    const height = 225 + Math.max(data.entries.length, 1) * 95 + 72;
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = BACKDROP; ctx.fillRect(0, 0, WIDTH, height);
    fillRoundRect(ctx, { x: 30, y: 24, width: 840, height: height - 48, radius: 32, fill: '#22232c' });
    ctx.save(); roundRectPath(ctx, 30, 24, 840, height - 48, 32); ctx.clip();
    drawLandscape(ctx, 30, 24, 840, 162);
    ctx.fillStyle = '#22232c'; ctx.fillRect(30, 185, 840, height - 209);
    ctx.restore();
    setFont(ctx, fonts, 52); ctx.fillStyle = TEXT; ctx.fillText('Ranking', 70, 114);
    if (!data.entries.length) {
      ctx.font = `26px ${fonts.body}`; ctx.fillStyle = MUTED; ctx.fillText('Ninguém ganhou moedas ainda.', 90, 257);
    }
    for (const [index, entry] of data.entries.entries()) {
      const y = 200 + index * 95;
      const colors = ['#3a322a', '#292b3e', '#352d2e'];
      fillRoundRect(ctx, { x: 48, y, width: 804, height: 84, radius: 20, fill: colors[entry.position - 1] ?? '#282a34' });
      setFont(ctx, fonts, 26); ctx.fillStyle = entry.position === 1 ? '#ffce59' : TEXT;
      ctx.fillText(entry.position <= 3 ? ['★', '◆', '●'][entry.position - 1] : String(entry.position), 72, y + 52);
      drawAvatar(ctx, { image: avatars.get(entry.avatarUrl ?? '') ?? null, cx: 185, cy: y + 42, radius: 30,
        initial: initialOf(entry.name), family: fonts.strong, fallbackFill: '#191a23', fallbackColor: TEXT });
      setFont(ctx, fonts, 28); ctx.fillStyle = TEXT;
      ctx.fillText(fitText(ctx, entry.name, 290), 240, y + 52);
      coin(ctx, 590, y + 42, 21);
      setFont(ctx, fonts, 28); ctx.fillStyle = TEXT;
      ctx.fillText(fitText(ctx, formatMoney(entry.balance), 150), 628, y + 52);
      ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.fillText(`#${entry.position}`, 824, y + 52); ctx.textAlign = 'left';
    }
    ctx.font = `20px ${fonts.body}`; ctx.fillStyle = MUTED;
    ctx.fillText(`${data.currencyName ?? 'Moedas'}  ·  Página ${data.page}/${data.pages}`, 70, height - 50);
    return canvas.toBuffer('image/png');
  } catch (err) {
    console.error('[economy] falha ao desenhar ranking:', err);
    return null;
  }
}

module.exports = { renderBalanceCard, renderEconomyRanking };
