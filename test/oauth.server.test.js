/** OAuth HTTP: state, exchange, refresh/revoke, guilds.join e encerramento do servidor. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.OAUTH_TOKEN_KEY = 'b'.repeat(64);
process.env.CLIENT_ID = 'client-id';
process.env.CLIENT_SECRET = 'client-secret';
process.env.DISCORD_TOKEN = 'bot-token';
process.env.OAUTH_REDIRECT_URI = 'http://127.0.0.1/callback';

const { db, setGuildConfig } = require('../database/db');
const { getTokens, saveTokens } = require('../oauth/tokenStore');
const { addUserToGuild, createOAuthUrl, pendingStates, revokeAuthorization, startOAuthServer } = require('../oauth/server');

const GUILD = '910000000000000001';
const OTHER_GUILD = '910000000000000002';
const USER = '910000000000000003';

function cleanup() {
  pendingStates.clear();
  db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(USER);
  db.prepare('DELETE FROM guild_config WHERE guild_id IN (?, ?)').run(GUILD, OTHER_GUILD);
  process.env.OAUTH_PORT = '0';
}

process.env.OAUTH_PORT = '0';

test.beforeEach(cleanup);
test.after(cleanup);

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body };
}

function stateFor(guildId = GUILD) {
  const url = new URL(createOAuthUrl(guildId));
  return url.searchParams.get('state');
}

function client({ roleFails = false } = {}) {
  return {
    guilds: {
      fetch: async () => ({
        members: { fetch: async () => ({ roles: { add: async () => { if (roleFails) throw new Error('Missing Permissions'); } } }) },
      }),
    },
  };
}

async function listen(server) {
  if (server.listening) return;
  server.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

async function callback(server, state, code = 'code') {
  const { port } = server.address();
  const path = `/callback?state=${state ?? ''}&code=${code}`;
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('callback aceita state válido uma vez, salva tokens e concede cargo sem bloquear falha de cargo', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url) => {
    calls.push(String(url));
    if (String(url).includes('/oauth2/token')) return response(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    if (String(url).includes('/users/@me')) return response(200, { id: USER, username: 'User' });
    throw new Error(`fetch inesperado: ${url}`);
  });
  setGuildConfig(GUILD, 'verify_role_id', '910000000000000010');
  const server = startOAuthServer(client({ roleFails: true }));
  t.after(() => close(server));
  await listen(server);
  const state = stateFor();

  const ok = await callback(server, state);
  const reused = await callback(server, state);

  assert.equal(ok.status, 200);
  assert.equal(reused.status, 400);
  assert.equal(getTokens(USER, GUILD).accessToken, 'access');
  assert.deepEqual(calls.map((u) => new URL(u).pathname), ['/api/v10/oauth2/token', '/api/v10/users/@me']);
});

test('state ausente, expirado ou de outra guild não grava autorização útil', async (t) => {
  t.mock.method(global, 'fetch', async () => response(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }));
  const server = startOAuthServer(client());
  t.after(() => close(server));
  await listen(server);

  assert.equal((await callback(server, null)).status, 400);

  const expired = stateFor();
  pendingStates.get(expired).expires = Date.now() - 1;
  assert.equal((await callback(server, expired)).status, 400);

  const other = stateFor(OTHER_GUILD);
  assert.equal((await callback(server, other)).status, 500, 'users/@me falha porque o mock não devolve usuário');
  assert.equal(getTokens(USER, GUILD), null);
});

test('falha no exchange ou users/@me retorna 500 e limpa state usado', async (t) => {
  let failUser = false;
  t.mock.method(global, 'fetch', async (url) => {
    if (String(url).includes('/users/@me')) return failUser ? response(401, {}) : response(200, { id: USER, username: 'User' });
    return response(401, { error: 'bad' });
  });
  const server = startOAuthServer(client());
  t.after(() => close(server));
  await listen(server);

  const exchangeState = stateFor();
  assert.equal((await callback(server, exchangeState)).status, 500);
  assert.equal(pendingStates.has(exchangeState), false);

  t.mock.reset();
  failUser = true;
  t.mock.method(global, 'fetch', async (url) => String(url).includes('/users/@me') ? response(401, {}) : response(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }));
  const userState = stateFor();
  assert.equal((await callback(server, userState)).status, 500);
  assert.equal(pendingStates.has(userState), false);
});

test('state inválido não é apagado do Map', async (t) => {
  t.mock.method(global, 'fetch', async () => response(500, {}));
  const server = startOAuthServer(client());
  t.after(() => close(server));
  await listen(server);
  const state = stateFor();

  assert.equal((await callback(server, 'outro')).status, 400);
  assert.equal(pendingStates.has(state), true);
});

test('refresh rotaciona token, falha apaga autorização, revoke chama Discord', async (t) => {
  const calls = [];
  let refreshOk = true;
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    if (String(url).includes('/guilds/')) return response(204, {});
    if (String(url).endsWith('/token/revoke')) return response(200, {});
    if (!refreshOk) return response(401, {});
    return response(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
  });

  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.deepEqual(await addUserToGuild({}, USER, GUILD), { ok: true, added: false });
  assert.equal(getTokens(USER, GUILD).refreshToken, 'new-refresh');

  await revokeAuthorization(USER, GUILD);
  assert.ok(calls.some((c) => c.body.includes('token=new-refresh')));
  assert.equal(getTokens(USER, GUILD), null);

  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'old-access', refreshToken: 'bad-refresh', expiresAt: new Date(Date.now() - 1000).toISOString() });
  refreshOk = false;
  assert.equal((await addUserToGuild({}, USER, GUILD)).ok, false);
  assert.equal(getTokens(USER, GUILD), null);
});

test('guilds.join trata 201, 204, 401, 403 e 429', async (t) => {
  const statuses = [201, 204, 401, 403, 429];
  t.mock.method(global, 'fetch', async (url) => {
    if (String(url).includes('/guilds/')) return response(statuses.shift(), { error: 'x' });
    return response(500, {});
  });

  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'access', expiresAt: new Date(Date.now() + 3600_000).toISOString() });

  assert.deepEqual(await addUserToGuild({}, USER, GUILD), { ok: true, added: true });
  assert.deepEqual(await addUserToGuild({}, USER, GUILD), { ok: true, added: false });
  for (const status of [401, 403, 429]) {
    const result = await addUserToGuild({}, USER, GUILD);
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(String(status)));
  }
});

test('porta ocupada emite error e close encerra limpo', async () => {
  const blocker = http.createServer().listen(0);
  await new Promise((resolve) => blocker.once('listening', resolve));
  process.env.OAUTH_PORT = String(blocker.address().port);

  const server = startOAuthServer(client());
  const error = await new Promise((resolve) => server.once('error', resolve));
  assert.equal(error.code, 'EADDRINUSE');

  await close(blocker);
});
