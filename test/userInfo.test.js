const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { PERMISSION_LABELS, parseMemberId, buildPermissionsEmbeds } = require('../commands/user/info');
const interactionCreate = require('../events/interactionCreate');

const USER_ID = '123456789012345678';

function memberWithRoles(count, name = 'Membro') {
  const guild = { id: '987654321098765432', name: 'Servidor'.repeat(10), members: {} };
  const roles = Array.from({ length: count }, (_, index) => ({
    id: String(100000000000000000n + BigInt(index)), position: index,
  }));
  const member = {
    id: USER_ID,
    guild,
    displayName: name,
    user: { displayAvatarURL: () => 'https://example.com/avatar.png' },
    permissions: { toArray: () => Object.keys(PermissionFlagsBits) },
    roles: { cache: {
      filter: (predicate) => ({ sort: (compare) => ({ map: (format) => roles.filter(predicate).sort(compare).map(format) }) }),
    } },
  };
  guild.members.fetch = async () => member;
  return guild;
}

async function clickUserInfo(guild, customId) {
  const replies = [];
  const interaction = {
    customId,
    guild,
    user: { id: USER_ID },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isButton: () => true,
    deferReply: async ({ flags }) => assert.equal(flags, MessageFlags.Ephemeral),
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };
  await interactionCreate.execute(interaction, {});
  return replies;
}

function embedCharacters(embed) {
  const { title, description, author, footer, fields = [] } = embed.toJSON();
  return (title?.length ?? 0) + (description?.length ?? 0)
    + (author?.name.length ?? 0) + (footer?.text.length ?? 0)
    + fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
}

test('parseMemberId accepts a Discord account ID', () => {
  assert.equal(parseMemberId('123456789012345678'), '123456789012345678');
});

test('parseMemberId rejects values that do not identify one user', () => {
  assert.equal(parseMemberId('someone'), null);
  assert.equal(parseMemberId('123456789012345678x'), null);
  assert.equal(parseMemberId('123'), null);
});

test('provides Portuguese labels for every Discord permission flag', () => {
  const { PermissionFlagsBits } = require('discord.js');
  assert.deepEqual(Object.keys(PERMISSION_LABELS).sort(), Object.keys(PermissionFlagsBits).sort());
});

test('parses the registered /user info subcommand for Discord', () => {
  const { data } = require('../commands/user/info');
  assert.doesNotThrow(() => data.toJSON());
  assert.equal(data.toJSON().options[0].name, 'info');
});

for (const count of [100, 200, 250]) {
  test(`permissions button sends all ${count} roles in valid message batches`, async () => {
    const guild = memberWithRoles(count, 'Membro'.repeat(35));
    if (count === 250) {
      const originalEmbeds = buildPermissionsEmbeds(await guild.members.fetch());
      assert.ok(originalEmbeds.length <= 10);
      assert.ok(originalEmbeds.reduce((total, embed) => total + embedCharacters(embed), 0) > 6000);
    }
    const replies = await clickUserInfo(guild, `userinfo_permissions_${USER_ID}`);
    if (count >= 200) assert.ok(replies.length > 1);
    assert.equal(replies.slice(1).every((reply) => reply.flags === MessageFlags.Ephemeral), true);
    const embeds = replies.flatMap((reply) => {
      assert.ok(reply.embeds.length <= 10);
      assert.ok(reply.embeds.reduce((total, embed) => total + embedCharacters(embed), 0) <= 6000);
      return reply.embeds;
    });
    assert.match(embeds[0].data.description, /Permissões gerais no servidor/);
    assert.equal(embeds.flatMap((embed) => embed.data.description.match(/<@&\d+>/g) ?? []).length, count);
  });
}

test('avatar button sends the avatar without permissions', async () => {
  const replies = await clickUserInfo(memberWithRoles(0), `userinfo_avatar_${USER_ID}`);
  assert.equal(replies.length, 1);
  assert.match(replies[0].embeds[0].data.title, /Avatar/);
  assert.equal(replies[0].embeds[0].data.image.url, 'https://example.com/avatar.png');
});

test('invalid userinfo view is rejected before fetching a member', async () => {
  const guild = memberWithRoles(0);
  guild.members.fetch = () => { throw new Error('unexpected fetch'); };
  const replies = await clickUserInfo(guild, `userinfo_other_${USER_ID}`);
  assert.match(replies[0].embeds[0].data.description, /Ação inválida/);
});

test('button reports when member has left the server', async () => {
  const guild = memberWithRoles(0);
  guild.members.fetch = async () => { throw new Error('Unknown Member'); };
  const replies = await clickUserInfo(guild, `userinfo_permissions_${USER_ID}`);
  assert.match(replies[0].embeds[0].data.description, /não está mais disponível/);
});
