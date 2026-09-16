const http = require('node:http');
const crypto = require('node:crypto');
const { saveTokens, getTokens, forgetTokens, authorizedGuilds, hasEncryptionKey } = require('./tokenStore');

// state -> guildId (anti-CSRF; expira em 10 min)
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

// Renova antes de vencer de fato: um token que expira durante a requisição
// devolve 401 e o usuário levaria a culpa de uma corrida de relógio.
const REFRESH_MARGIN_MS = 60 * 1000;

function createOAuthUrl(guildId) {
  const { CLIENT_ID, OAUTH_REDIRECT_URI } = process.env;
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, { guildId, expires: Date.now() + STATE_TTL_MS });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

/** POST no endpoint de token do Discord com as credenciais da aplicação. */
async function tokenRequest(path, params) {
  const { CLIENT_ID, CLIENT_SECRET } = process.env;
  const res = await fetch(`https://discord.com/api/v10/oauth2/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  return res;
}

async function exchangeCode(code) {
  const res = await tokenRequest('token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.OAUTH_REDIRECT_URI,
  });
  if (!res.ok) throw new Error(`Token exchange falhou: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Troca o refresh token por um par novo.
 *
 * O Discord devolve um refresh token novo a cada renovação e invalida o
 * anterior, então o retorno precisa ser gravado inteiro — guardar só o access
 * token deixaria o usuário sem como renovar na próxima vez.
 *
 * @returns {Promise<{access_token: string, refresh_token?: string, expires_in: number}|null>}
 */
async function refreshTokens(refreshToken) {
  const res = await tokenRequest('token', { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!res.ok) {
    console.warn(`[oauth] Refresh recusado: ${res.status}`);
    return null;
  }
  return res.json();
}

/**
 * Avisa o Discord para invalidar o token. Sem isso, "desautorizar" só apagaria
 * a nossa cópia — o token continuaria válido até vencer sozinho.
 */
async function revokeAtDiscord(token, hint) {
  if (!token) return;
  await tokenRequest('token/revoke', { token, token_type_hint: hint })
    .then((res) => {
      if (!res.ok) console.warn(`[oauth] Revoke recusado: ${res.status}`);
    })
    .catch((err) => console.warn('[oauth] Revoke falhou:', err.message));
}

async function fetchOAuthUser(accessToken) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`users/@me falhou: ${res.status}`);
  return res.json();
}

/**
 * Devolve um access token válido para o par (usuário, servidor), renovando se
 * estiver vencido ou quase.
 *
 * @returns {Promise<{ok: true, accessToken: string} | {ok: false, reason: string}>}
 */
async function validAccessToken(userId, guildId) {
  const stored = getTokens(userId, guildId);
  if (!stored) {
    return { ok: false, reason: 'Usuário nunca autorizou o bot via OAuth **neste servidor**.' };
  }

  const expiresAt = stored.expiresAt ? new Date(stored.expiresAt).getTime() : 0;
  if (expiresAt && expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return { ok: true, accessToken: stored.accessToken };
  }

  if (!stored.refreshToken) {
    return { ok: false, reason: 'Autorização expirada e sem refresh token. O usuário precisa verificar novamente.' };
  }

  const renewed = await refreshTokens(stored.refreshToken).catch(() => null);
  if (!renewed?.access_token) {
    // Refresh recusado significa autorização revogada do lado do Discord: a
    // cópia local só mentiria daqui para frente.
    forgetTokens(userId, guildId);
    return { ok: false, reason: 'Autorização não pôde ser renovada (provavelmente revogada). O usuário precisa verificar novamente.' };
  }

  saveTokens({
    userId,
    guildId,
    accessToken: renewed.access_token,
    refreshToken: renewed.refresh_token ?? stored.refreshToken,
    expiresAt: new Date(Date.now() + renewed.expires_in * 1000).toISOString(),
  });

  return { ok: true, accessToken: renewed.access_token };
}

/**
 * Remove a autorização de um usuário: revoga no Discord e apaga a cópia local.
 *
 * @param {string} userId
 * @param {string|null} [guildId] omitido/`null` = todos os servidores
 * @returns {Promise<{revoked: number}>}
 */
async function revokeAuthorization(userId, guildId) {
  const targets = guildId ? [guildId] : authorizedGuilds(userId);

  for (const target of targets) {
    const stored = getTokens(userId, target);
    if (!stored) continue;
    await revokeAtDiscord(stored.refreshToken, 'refresh_token');
    await revokeAtDiscord(stored.accessToken, 'access_token');
  }

  return { revoked: forgetTokens(userId, guildId ?? null) };
}

/**
 * Adiciona um usuário previamente autorizado a um servidor (guilds.join).
 * Requer que o bot esteja no servidor com permissão Create Invite.
 *
 * O token é procurado por `(userId, guildId)`: a autorização dada em um
 * servidor não serve para arrastar a conta para outro.
 */
async function addUserToGuild(client, userId, guildId) {
  const token = await validAccessToken(userId, guildId);
  if (!token.ok) return token;

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: token.accessToken }),
  });

  if (res.status === 201) return { ok: true, added: true };
  if (res.status === 204) return { ok: true, added: false }; // já era membro
  return { ok: false, reason: `Discord retornou ${res.status}: ${await res.text()}` };
}

function htmlPage(title, body) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;background:#2b2d31;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#313338;padding:2rem 3rem;border-radius:12px;text-align:center;max-width:420px}</style></head>
<body><div class="card"><h2>${title}</h2><p>${body}</p></div></body></html>`;
}

/** Inicia o servidor HTTP do callback OAuth. Chamar apenas se CLIENT_SECRET estiver definido. */
function startOAuthServer(client) {
  const rawPort = process.env.OAUTH_PORT;
  const port = rawPort === '0' ? 0 : Number(rawPort || 3000);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404).end('Not found');
      return;
    }

    try {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const pending = pendingStates.get(state);

      if (!code || !pending || pending.expires < Date.now()) {
        if (pending) pendingStates.delete(state);
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('Link inválido ou expirado', 'Volte ao Discord e clique no botão de verificação novamente.'));
        return;
      }

      pendingStates.delete(state);

      const token = await exchangeCode(code);
      const user = await fetchOAuthUser(token.access_token);
      const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

      saveTokens({
        userId: user.id,
        guildId: pending.guildId,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt,
      });

      // dá o cargo de verificado, se configurado
      const { getGuildConfig } = require('../database/db');
      const config = getGuildConfig(pending.guildId);
      if (config?.verify_role_id) {
        const guild = await client.guilds.fetch(pending.guildId).catch(() => null);
        const member = await guild?.members.fetch(user.id).catch(() => null);
        await member?.roles.add(config.verify_role_id, 'Verificação via OAuth').catch(() => {});
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('✅ Verificado!', `Conta <b>${user.username}</b> conectada com sucesso. Pode fechar esta aba e voltar ao Discord.`));
    } catch (err) {
      console.error('[oauth] Erro no callback:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlPage('Erro', 'Falha na verificação. Tente novamente ou avise a staff.'));
    }
  });

  server.on('error', (err) => console.error('[oauth] Servidor de callback falhou:', err.message));
  if (rawPort !== '0') server.listen(port, () => console.log(`[oauth] Servidor de callback OAuth em http://localhost:${port}/callback`));
  return server;
}

/**
 * A chave de criptografia entra na conta de propósito: sem ela os tokens
 * ficariam em texto puro no SQLite, então a feature fica desligada em vez de
 * rodar insegura.
 */
const isOAuthEnabled = () =>
  Boolean(process.env.CLIENT_SECRET && process.env.OAUTH_REDIRECT_URI && process.env.CLIENT_ID) &&
  hasEncryptionKey();

module.exports = { startOAuthServer, createOAuthUrl, addUserToGuild, revokeAuthorization, isOAuthEnabled, pendingStates };
