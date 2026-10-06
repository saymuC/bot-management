const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { isAllowed, routeBotStatus } = require('../handlers/botStatusHandler');
const command = require('../commands/config/bot-status');

const OWNER = '900000000000000001';
const OTHER = '900000000000000002';

function interaction(userId, guildId) {
  const calls = [];
  return {
    user: { id: userId },
    guildId,
    guild: { id: guildId, ownerId: userId },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    customId: 'bstatus_apply',
    createdTimestamp: Date.now(),
    client: { guilds: { cache: { size: 0 } } },
    calls,
    reply: async (payload) => calls.push(['reply', payload]),
    update: async (payload) => calls.push(['update', payload]),
  };
}

test('somente OWNER_ID válido controla presença global em todos os servidores', async (t) => {
  const old = process.env.OWNER_ID;
  t.after(() => {
    if (old === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = old;
  });

  for (const configured of [undefined, '', 'abc', '12345678901234567oops', '0'.repeat(22)]) {
    if (configured === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = configured;
    for (const guildId of ['900000000000000010', '900000000000000011']) {
      for (const userId of [OWNER, OTHER]) {
        const i = interaction(userId, guildId);
        assert.equal(isAllowed(i), false);
        await command.execute(i);
        await routeBotStatus(i);
        assert.deepEqual(i.calls.map(([method]) => method), ['reply', 'reply']);
        assert.equal(i.calls[1][1].flags, MessageFlags.Ephemeral);
      }
    }
  }

  process.env.OWNER_ID = ` ${OWNER} `;
  for (const guildId of ['900000000000000010', '900000000000000011']) {
    const owner = interaction(OWNER, guildId);
    const admin = interaction(OTHER, guildId);
    assert.equal(isAllowed(owner), true);
    assert.equal(isAllowed(admin), false, 'nem o dono do servidor ou um administrador pode alterar o bot');
    await command.execute(owner);
    assert.equal(owner.calls[0][0], 'reply');
    assert.match(owner.calls[0][1].content, /Painel de status/);
    await routeBotStatus(admin);
    assert.deepEqual(admin.calls.map(([method]) => method), ['reply']);
  }
});

test('painel antigo e modal não aplicam nem abrem quando OWNER_ID é removido', async (t) => {
  const old = process.env.OWNER_ID;
  t.after(() => {
    if (old === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = old;
  });
  process.env.OWNER_ID = OWNER;
  const i = interaction(OWNER, '900000000000000010');
  await command.execute(i);
  delete process.env.OWNER_ID;
  for (const customId of ['bstatus_apply', 'bstatus_status', 'bstatus_modal-texts', 'bstatus_texts']) {
    i.customId = customId;
    await routeBotStatus(i);
    assert.equal(i.calls.at(-1)[0], 'reply');
    assert.equal(i.calls.at(-1)[1].flags, MessageFlags.Ephemeral);
  }
});
