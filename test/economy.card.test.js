const test = require('node:test');
const assert = require('node:assert/strict');
const { loadImage } = require('@napi-rs/canvas');
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
