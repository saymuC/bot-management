const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { checkCanvasFonts } = require('../utils/canvasFonts');
const { renderBalanceCard, renderEconomyRanking } = require('../utils/economy/card');

const available = checkCanvasFonts().ok;

test('saldo desenha PNG com banner padrão, saldo zero e posição ausente', { skip: !available }, async () => {
  const png = await renderBalanceCard({ name: 'Usuário de teste', balance: 0, position: null, status: 'idle' });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const image = await loadImage(png);
  assert.equal(image.width, 900);
  assert.equal(image.height, 500);
});

test('saldo só desenha indicador de presença quando o status está disponível', { skip: !available }, async () => {
  const pixel = async (status) => {
    const png = await renderBalanceCard({ name: 'Teste', balance: 0, position: null, status });
    const canvas = createCanvas(900, 500);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(await loadImage(png), 0, 0);
    return [...ctx.getImageData(247, 272, 1, 1).data];
  };
  assert.deepEqual(await pixel('offline'), [120, 128, 145, 255]);
  assert.notDeepEqual(await pixel(undefined), await pixel('offline'));
});

test('ranking desenha página vazia, parcial e completa sem avatar externo', { skip: !available }, async () => {
  for (const count of [0, 6, 10]) {
    const png = await renderEconomyRanking({ page: 2, pages: 2, entries: Array.from({ length: count }, (_, i) => ({
      position: i + 11, name: `Pessoa ${i}`, balance: 1_000_000_000, avatarUrl: null,
    })) });
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const image = await loadImage(png);
    assert.equal(image.width, 900);
    assert.ok(image.height < 1300);
  }
});
