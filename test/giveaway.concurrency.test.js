/**
 * O sorteio só pode ser encerrado uma vez.
 *
 * Duas varreduras sobrepostas (ou duas instâncias do bot no mesmo banco) podem
 * ler a mesma linha com `ended = 0` e chamar `endGiveaway` em paralelo. Quem
 * decide é o `UPDATE ... WHERE ended = 0`: só um recebe `changes = 1`, e é esse
 * que anuncia. O teste trava esse contrato.
 *
 * O client é um objeto de mentira que devolve canal nenhum — o que interessa
 * aqui é o retorno, não a mensagem no Discord.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { db } = require('../database/db');
const { endGiveaway, cancelGiveaway } = require('../handlers/giveawayHandler');

const GUILD = 'test-giveaway-concurrency';
const client = { channels: { fetch: async () => null } };

const cleanup = () => db.prepare('DELETE FROM giveaways WHERE guild_id = ?').run(GUILD);
test.beforeEach(cleanup);
test.after(cleanup);

function novoSorteio() {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO giveaways (guild_id, channel_id, prize, winners_count, ends_at)
       VALUES (?, '1', 'Prêmio', 1, datetime('now', '-1 minute'))`
    )
    .run(GUILD);

  return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(lastInsertRowid);
}

test('endGiveaway encerra uma vez e recusa a segunda', async () => {
  const giveaway = novoSorteio();

  assert.equal(await endGiveaway(client, giveaway), true);
  // Mesmo objeto lido antes do encerramento: é exatamente o que a segunda
  // varredura teria em mãos.
  assert.equal(await endGiveaway(client, giveaway), false);

  assert.equal(db.prepare('SELECT ended FROM giveaways WHERE id = ?').get(giveaway.id).ended, 1);
});

test('endGiveaway em paralelo só deixa um passar', async () => {
  const giveaway = novoSorteio();

  const resultados = await Promise.all([
    endGiveaway(client, giveaway),
    endGiveaway(client, giveaway),
    endGiveaway(client, giveaway),
  ]);

  assert.equal(resultados.filter(Boolean).length, 1);
});

test('cancelGiveaway não pega um sorteio já encerrado', async () => {
  const giveaway = novoSorteio();

  assert.equal(await endGiveaway(client, giveaway), true);
  assert.equal(await cancelGiveaway(client, giveaway, { id: '42' }), false);

  const row = db.prepare('SELECT cancelled, cancelled_by FROM giveaways WHERE id = ?').get(giveaway.id);
  assert.equal(row.cancelled, 0, 'o cancelamento perdido não pode reescrever o registro');
  assert.equal(row.cancelled_by, null);
});

test('cancelGiveaway encerra uma vez e recusa a segunda', async () => {
  const giveaway = novoSorteio();

  assert.equal(await cancelGiveaway(client, giveaway, { id: '42' }), true);
  assert.equal(await cancelGiveaway(client, giveaway, { id: '42' }), false);

  const row = db.prepare('SELECT ended, cancelled, cancelled_by FROM giveaways WHERE id = ?').get(giveaway.id);
  assert.deepEqual([row.ended, row.cancelled, row.cancelled_by], [1, 1, '42']);
});
