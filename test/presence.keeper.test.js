/**
 * O guardião existe por um motivo só: reconexão zera a presença do lado do
 * Discord. Se ele parar de reaplicar no `shardResume`, o status desaparece
 * sozinho depois de horas no ar — e ninguém liga o sintoma à causa.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Events } = require('discord.js');
const { startPresenceKeeper, setDesiredPresence } = require('../utils/presenceKeeper');

test('reaplica a presença no boot e em cada reconexão', () => {
  const sent = [];
  const client = new EventEmitter();
  client.user = { setPresence: (data) => sent.push(data) };

  startPresenceKeeper(client);
  assert.equal(sent.length, 1, 'devia aplicar no boot');

  const manual = setDesiredPresence(client, { status: 'dnd', activity: 'watching', name: 'vários servers' });
  assert.equal(manual.status, 'dnd');
  assert.equal(sent.length, 2, 'a alteração manual aplica na hora');

  client.emit(Events.ShardResume);
  assert.deepEqual(sent.at(-1), sent.at(-2), 'a reconexão reaplica o último status pedido');
});
