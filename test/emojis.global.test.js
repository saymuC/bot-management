const test = require('node:test');
const assert = require('node:assert/strict');

const { getBotSetting } = require('../database/db');
const { emoji, getGuildEmojis, resetGuildEmojis, setGuildEmoji } = require('../utils/emojis');

test('configuração de emojis é global para todos os servidores', () => {
  resetGuildEmojis('guild-a');

  setGuildEmoji('guild-a', 'config_center', '🧭');

  assert.equal(emoji({ id: 'guild-a' }, 'config_center'), '🧭');
  assert.equal(emoji({ id: 'guild-b' }, 'config_center'), '🧭');
  assert.equal(getGuildEmojis('guild-b').config_center, '🧭');
  assert.match(getBotSetting('emoji_config'), /config_center/);

  resetGuildEmojis('guild-b');
});
