const test = require('node:test');
const assert = require('node:assert/strict');
const { PERMISSION_LABELS, parseMemberId } = require('../commands/user/info');

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
