const http = require('node:http');
const crypto = require('node:crypto');
const { db } = require('../database/db');

// tokens OAuth de usuários que autorizaram via botão de verificação
db.exec(`
CREATE TABLE IF NOT EXISTS oauth_users (
  user_id TEXT PRIMARY KEY,
  guild_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT,
  authorized_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const upsertToken = db.prepare(`
INSERT INTO oauth_users (user_id, guild_id, access_token, refresh_token, expires_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
  guild_id = excluded.guild_id,
  access_token = excluded.access_token,
  refresh_token = excluded.refresh_token,
  expires_at = excluded.expires_at,
  authorized_at = CURRENT_TIMESTAMP
`);
const getToken = db.prepare('SELECT * FROM oauth_users WHERE user_id = ?');

// state -> guildId (anti-CSRF; expira em 10 min)
const pendingStates = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

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

async function exchangeCode(code) {
  const { CLIENT_ID, CLIENT_SECRET, OAUTH_REDIRECT_URI } = process.env;
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange falhou: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchOAuthUser(accessToken) {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`users/@me falhou: ${res.status}`);
  return res.json();
}

/**
 * Adiciona um usuário previamente autorizado a um servidor (guilds.join).
 * Requer que o bot esteja no servidor com permissão Create Invite.
 */
async function addUserToGuild(client, userId, guildId) {
  const row = getToken.get(userId);
  if (!row) return { ok: false, reason: 'Usuário nunca autorizou o bot via OAuth.' };
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, reason: 'Autorização expirada. O usuário precisa verificar novamente.' };
  }

  const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: row.access_token }),
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
  const port = Number(process.env.OAUTH_PORT || 3000);

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
      pendingStates.delete(state);

      if (!code || !pending || pending.expires < Date.now()) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage('Link inválido ou expirado', 'Volte ao Discord e clique no botão de verificação novamente.'));
        return;
      }

      const token = await exchangeCode(code);
      const user = await fetchOAuthUser(token.access_token);
      const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

      upsertToken.run(user.id, pending.guildId, token.access_token, token.refresh_token ?? null, expiresAt);

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

  server.listen(port, () => console.log(`[oauth] Servidor de callback OAuth em http://localhost:${port}/callback`));
  return server;
}

const isOAuthEnabled = () =>
  Boolean(process.env.CLIENT_SECRET && process.env.OAUTH_REDIRECT_URI && process.env.CLIENT_ID);

module.exports = { startOAuthServer, createOAuthUrl, addUserToGuild, isOAuthEnabled };
