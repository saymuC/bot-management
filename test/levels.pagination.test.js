/**
 * Testes dos botões de página do `/top`.
 *
 * O que importa aqui é a regra combinada: os dois botões existem sempre, e só ficam
 * clicáveis quando há mais de uma página. É fácil de quebrar sem ninguém notar —
 * componente que não aparece não dá erro em lugar nenhum.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { PREFIX, pageComponents } = require('../handlers/levelsLeaderboardHandler');

/** Os dois botões, já em JSON, na ordem em que vão para o Discord. */
function botoes(page, pages) {
  const rows = pageComponents(page, pages);
  assert.equal(rows.length, 1, 'os botões vivem numa linha só');
  return rows[0].toJSON().components;
}

test('com uma página só os dois botões aparecem desabilitados', () => {
  const [anterior, proxima] = botoes(1, 1);

  assert.equal(anterior.emoji.name, '⬅️');
  assert.equal(proxima.emoji.name, '➡️');
  assert.equal(anterior.disabled, true);
  assert.equal(proxima.disabled, true);
});

test('na primeira de várias páginas só o "próxima" fica ativo', () => {
  const [anterior, proxima] = botoes(1, 3);

  assert.equal(anterior.disabled, true);
  assert.equal(proxima.disabled, false);
});

test('no meio da paginação os dois ficam ativos', () => {
  const [anterior, proxima] = botoes(2, 3);

  assert.equal(anterior.disabled, false);
  assert.equal(proxima.disabled, false);
});

test('na última página só o "anterior" fica ativo', () => {
  const [anterior, proxima] = botoes(3, 3);

  assert.equal(anterior.disabled, false);
  assert.equal(proxima.disabled, true);
});

test('o customId carrega a página de destino com o prefixo do ranking', () => {
  const [anterior, proxima] = botoes(2, 3);

  assert.equal(anterior.custom_id, `${PREFIX}1`);
  assert.equal(proxima.custom_id, `${PREFIX}3`);
});
