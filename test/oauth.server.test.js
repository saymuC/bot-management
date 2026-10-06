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

function stateFor(guildId = GUILD, userId = USER) {
  const url = new URL(createOAuthUrl(guildId, userId));
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
  assert.equal((await callback(server, other)).status, 403, 'users/@me não corresponde ao state');
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

test('state pertence à conta que concluiu o captcha; conta diferente recebe 403 e token revogado', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ path: new URL(url).pathname, body: String(init?.body ?? '') });
    if (String(url).endsWith('/token/revoke')) return response(200);
    if (String(url).includes('/users/@me')) return response(200, { id: 'attacker', username: 'Attacker' });
    return response(200, { access_token: 'stolen', refresh_token: 'refresh', expires_in: 3600 });
  });
  setGuildConfig(GUILD, 'verify_role_id', '910000000000000010');
  let roleCalls = 0;
  const bot = { guilds: { fetch: async () => { roleCalls++; return null; } } };
  const server = startOAuthServer(bot);
  t.after(() => close(server));
  await listen(server);
  const state = stateFor();

  assert.equal((await callback(server, state)).status, 403);
  assert.equal((await callback(server, state)).status, 400);
  assert.equal(pendingStates.has(state), false);
  assert.equal(getTokens('attacker', GUILD), null);
  assert.equal(getTokens(USER, GUILD), null);
  assert.equal(roleCalls, 0);
  assert.deepEqual(calls.map((c) => c.path), ['/api/v10/oauth2/token', '/api/v10/users/@me', '/api/v10/oauth2/token/revoke']);
  assert.match(calls[2].body, /token=stolen/);
});

test('createOAuthUrl exige a identidade e remove states expirados sem callback', async (t) => {
  assert.throws(() => createOAuthUrl(GUILD), /userId/);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const state = stateFor();
  assert.equal(pendingStates.get(state).userId, USER);
  t.mock.timers.tick(10 * 60 * 1000);
  assert.equal(pendingStates.has(state), false);
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

test('refresh simultâneo para o mesmo par usa uma troca e um token novo', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    if (String(url).includes('/guilds/')) return response(204);
    await gate;
    return response(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
  });
  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'old', refreshToken: 'old-refresh', expiresAt: new Date(Date.now() - 1000).toISOString() });
  const first = addUserToGuild({}, USER, GUILD);
  const second = addUserToGuild({}, USER, GUILD);
  assert.equal(calls.filter((c) => c.url.endsWith('/oauth2/token')).length, 1);
  release();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(getTokens(USER, GUILD).refreshToken, 'new-refresh');
  assert.equal(calls.filter((c) => c.url.includes('/guilds/')).length, 2);
  assert.ok(calls.filter((c) => c.url.includes('/guilds/')).every((c) => c.body.includes('new-access')));
});

test('refresh recusado não apaga autorização substituída enquanto aguardava Discord', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.mock.method(global, 'fetch', async () => { await gate; return response(401); });
  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'old', refreshToken: 'old-refresh', expiresAt: new Date(Date.now() - 1000).toISOString() });
  const pending = addUserToGuild({}, USER, GUILD);
  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'replacement', refreshToken: 'replacement-refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  release();
  assert.equal((await pending).ok, false);
  assert.equal(getTokens(USER, GUILD).accessToken, 'replacement');
});

test('refresh tardio não sobrescreve autorização substituída enquanto aguardava Discord', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.mock.method(global, 'fetch', async () => {
    await gate;
    return response(200, { access_token: 'stale', refresh_token: 'stale-refresh', expires_in: 3600 });
  });
  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'old', refreshToken: 'old-refresh', expiresAt: new Date(Date.now() - 1000).toISOString() });
  const pending = addUserToGuild({}, USER, GUILD);
  saveTokens({ userId: USER, guildId: GUILD, accessToken: 'replacement', refreshToken: 'replacement-refresh', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  release();
  assert.equal((await pending).ok, false);
  assert.equal(getTokens(USER, GUILD).accessToken, 'replacement');
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
