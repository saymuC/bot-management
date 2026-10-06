const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchChannelHistory } = require('../utils/transcript');

test('transcript limita mensagens pela idade sem perder mensagens recentes', async () => {
  if (process.env.TRANSCRIPT_RETENTION_DAYS !== undefined) return;
  const now = Date.now();
  const messages = [
    { id: 'new', createdTimestamp: now },
    { id: 'old', createdTimestamp: now - 40 * 86_400_000 },
  ];
  let calls = 0;
  const channel = { messages: { fetch: async () => {
    calls += 1;
    return { size: messages.length, values: () => messages.values(), last: () => messages.at(-1) };
  } } };
  const result = await fetchChannelHistory(channel);
  assert.deepEqual(result.map((message) => message.id), ['new']);
  assert.equal(calls, 1);
});

test('transcript interrompe paginação quando alcança mensagens anteriores ao prazo', async () => {
  if (process.env.TRANSCRIPT_RETENTION_DAYS !== undefined) return;
  const now = Date.now();
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: String(index), createdTimestamp: now - index * 86_400_000,
  }));
  let calls = 0;
  const channel = { messages: { fetch: async () => {
    calls += 1;
    return { size: messages.length, values: () => messages.values(), last: () => messages.at(-1) };
  } } };
  const result = await fetchChannelHistory(channel);
  assert.ok(result.length >= 30 && result.length <= 31);
  assert.equal(calls, 1);
});
