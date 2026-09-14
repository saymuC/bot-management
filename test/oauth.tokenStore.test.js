/**
 * Testes da guarda de tokens OAuth.
 *
 * O que precisa valer: o token volta igual ao que entrou, não fica legível no
 * banco, um registro adulterado não abre, e a chave `(user_id, guild_id)`
 * mantém autorizações de servidores diferentes separadas.
 *
 * A chave de criptografia é definida antes do require porque o módulo só lê o
 * ambiente na primeira operação — mas o teste não deve depender do .env real.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OAUTH_TOKEN_KEY = 'a'.repeat(64);

const { db } = require('../database/db');
const { encrypt, decrypt, saveTokens, getTokens, forgetTokens, authorizedGuilds } = require('../oauth/tokenStore');

const USER = 'test-oauth-user';
const GUILD_A = 'test-oauth-guild-a';
const GUILD_B = 'test-oauth-guild-b';

const cleanup = () => db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(USER);
test.beforeEach(cleanup);
test.after(cleanup);

test('encrypt/decrypt faz round-trip e nunca repete o texto cifrado', () => {
  const plain = 'token-super-secreto';
  const a = encrypt(plain);
  const b = encrypt(plain);

  assert.equal(decrypt(a), plain);
  assert.equal(decrypt(b), plain);
  // IV aleatório: o mesmo token cifrado duas vezes não deve dar o mesmo blob,
  // senão dá para comparar registros e saber quem compartilha token.
  assert.notEqual(a, b);
  assert.ok(!a.includes(plain));
});

test('decrypt recusa dado adulterado ou malformado', () => {
  const [iv, tag, body] = encrypt('original').split(':');
  const trocado = body.replace(/^../, body.startsWith('00') ? '11' : '00');

  assert.equal(decrypt([iv, tag, trocado].join(':')), null);
  assert.equal(decrypt('nao-tem-separador'), null);
  assert.equal(decrypt(null), null);
  assert.equal(decrypt(''), null);
});

test('o token gravado não fica legível na tabela', () => {
  saveTokens({ userId: USER, guildId: GUILD_A, accessToken: 'acesso-1', refreshToken: 'refresh-1' });

  const row = db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? AND guild_id = ?').get(USER, GUILD_A);
  assert.ok(!row.access_token.includes('acesso-1'));
  assert.ok(!row.refresh_token.includes('refresh-1'));

  assert.deepEqual(getTokens(USER, GUILD_A), {
    accessToken: 'acesso-1',
    refreshToken: 'refresh-1',
    expiresAt: null,
  });
});

test('autorizações de servidores diferentes convivem', () => {
  saveTokens({ userId: USER, guildId: GUILD_A, accessToken: 'acesso-a' });
  saveTokens({ userId: USER, guildId: GUILD_B, accessToken: 'acesso-b' });

  assert.equal(getTokens(USER, GUILD_A).accessToken, 'acesso-a');
  assert.equal(getTokens(USER, GUILD_B).accessToken, 'acesso-b');
  assert.deepEqual(authorizedGuilds(USER).sort(), [GUILD_A, GUILD_B].sort());
});

test('regravar o mesmo par (usuário, servidor) substitui em vez de duplicar', () => {
  saveTokens({ userId: USER, guildId: GUILD_A, accessToken: 'antigo' });
  saveTokens({ userId: USER, guildId: GUILD_A, accessToken: 'novo' });

  assert.equal(getTokens(USER, GUILD_A).accessToken, 'novo');
  assert.equal(authorizedGuilds(USER).length, 1);
});

test('forgetTokens apaga um servidor ou todos', () => {
  saveTokens({ userId: USER, guildId: GUILD_A, accessToken: 'acesso-a' });
  saveTokens({ userId: USER, guildId: GUILD_B, accessToken: 'acesso-b' });

  assert.equal(forgetTokens(USER, GUILD_A), 1);
  assert.equal(getTokens(USER, GUILD_A), null);
  assert.equal(getTokens(USER, GUILD_B).accessToken, 'acesso-b');

  assert.equal(forgetTokens(USER), 1);
  assert.deepEqual(authorizedGuilds(USER), []);
});

test('registro que não abre com a chave atual sai do banco', () => {
  saveTokens({ userId: USER, guildId: GUILD_A, accessToken: 'acesso' });
  db.prepare('UPDATE oauth_tokens SET access_token = ? WHERE user_id = ?').run('lixo:lixo:lixo', USER);

  assert.equal(getTokens(USER, GUILD_A), null);
  assert.deepEqual(authorizedGuilds(USER), [], 'a linha inútil deveria ter sido removida');
});
