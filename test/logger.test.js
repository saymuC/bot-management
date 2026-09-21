const test = require('node:test');
const assert = require('node:assert/strict');

const { setGuildConfig } = require('../database/db');
const { logEvent } = require('../utils/logger');

test('logEvent nao envia logs para canal de outra guild', async () => {
  setGuildConfig('guild-a', 'log_channel_id', 'channel-b');

  let sent = false;
  const guild = {
    id: 'guild-a',
    client: {
      channels: {
        fetch: async () => ({
          guildId: 'guild-b',
          isTextBased: () => true,
          send: async () => {
            sent = true;
          },
        }),
      },
    },
  };

  await logEvent(guild, 'titulo', 'descricao');

  assert.equal(sent, false);
});

test('logEvent envia logs para canal da mesma guild', async () => {
  setGuildConfig('guild-a', 'log_channel_id', 'channel-a');

  let sent = false;
  const guild = {
    id: 'guild-a',
    client: {
      channels: {
        fetch: async () => ({
          guildId: 'guild-a',
          isTextBased: () => true,
          send: async () => {
            sent = true;
          },
        }),
      },
    },
  };

  await logEvent(guild, 'titulo', 'descricao');

  assert.equal(sent, true);
});
