// @ts-check
/**
 * Guarda dos tokens OAuth dos usuários.
 *
 * Estes tokens valem `guilds.join`: quem os tem consegue puxar a conta para
 * dentro de um servidor. Por isso duas decisões moram aqui.
 *
 * 1. **Cifrados em repouso.** O arquivo `.sqlite` acompanha backup, sync e
 *    máquina de dev; um vazamento do arquivo não deve virar um vazamento de
 *    tokens. A chave fica no ambiente (`OAUTH_TOKEN_KEY`), fora do banco.
 * 2. **Chave `(user_id, guild_id)`.** A autorização é dada em um servidor
 *    específico. Com a chave só em `user_id`, autorizar no servidor B apagava a
 *    do servidor A — e pior, o token de um servidor servia para entrar em
 *    qualquer outro onde o bot estivesse.
 */

const crypto = require('node:crypto');
const { db } = require('../database/db');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // tamanho canônico do nonce em GCM
const KEY_HINT = 'Gere uma com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"';

db.exec(`
CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TEXT,
  authorized_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, guild_id)
);
`);

const stmts = {
  upsert: db.prepare(`
    INSERT INTO oauth_tokens (user_id, guild_id, access_token, refresh_token, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, guild_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      authorized_at = CURRENT_TIMESTAMP
  `),
  get: db.prepare('SELECT * FROM oauth_tokens WHERE user_id = ? AND guild_id = ?'),
  remove: db.prepare('DELETE FROM oauth_tokens WHERE user_id = ? AND guild_id = ?'),
  removeAll: db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?'),
  listForUser: db.prepare('SELECT guild_id FROM oauth_tokens WHERE user_id = ?'),
};

/** @type {Buffer|null} */
let cachedKey = null;

/**
 * A chave é lida na primeira operação, não no import: OAuth é opcional e o bot
 * inteiro não deve morrer por causa de uma feature desligada.
 *
 * @returns {Buffer}
 */
function encryptionKey() {
  if (cachedKey) return cachedKey;

  const raw = String(process.env.OAUTH_TOKEN_KEY ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`OAUTH_TOKEN_KEY precisa ter 64 caracteres hexadecimais (32 bytes). ${KEY_HINT}`);
  }

  cachedKey = Buffer.from(raw, 'hex');
  return cachedKey;
}

/** @returns {boolean} */
function hasEncryptionKey() {
  return /^[0-9a-fA-F]{64}$/.test(String(process.env.OAUTH_TOKEN_KEY ?? '').trim());
}

/**
 * @param {string} plain
 * @returns {string} `iv:tag:ciphertext`, tudo em hex
 */
function encrypt(plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), body.toString('hex')].join(':');
}

/**
 * O GCM autentica: token adulterado no banco falha aqui em vez de virar uma
 * requisição com credencial estranha.
 *
 * @param {string|null|undefined} blob
 * @returns {string|null} `null` quando o dado não abre (chave trocada, registro corrompido)
 */
function decrypt(blob) {
  if (!blob) return null;

  const [iv, tag, body] = String(blob).split(':');
  if (!iv || !tag || !body) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * @param {{userId: string, guildId: string, accessToken: string, refreshToken?: string|null, expiresAt?: string|null}} entry
 */
function saveTokens({ userId, guildId, accessToken, refreshToken, expiresAt }) {
  stmts.upsert.run(
    userId,
    guildId,
    encrypt(accessToken),
    refreshToken ? encrypt(refreshToken) : null,
    expiresAt ?? null
  );
}

/**
 * @param {string} userId
 * @param {string} guildId
 * @returns {{accessToken: string, refreshToken: string|null, expiresAt: string|null} | null}
 */
function getTokens(userId, guildId) {
  const row = stmts.get.get(userId, guildId);
  if (!row) return null;

  const accessToken = decrypt(row.access_token);
  // Sem access token legível o registro não serve para nada: sai do banco para
  // não ficar dando falsa impressão de que o usuário está autorizado.
  if (!accessToken) {
    stmts.remove.run(userId, guildId);
    return null;
  }

  return { accessToken, refreshToken: decrypt(row.refresh_token), expiresAt: row.expires_at ?? null };
}

/**
 * @param {string} userId
 * @param {string|null} [guildId] omitido/`null` remove a autorização em todos os servidores
 * @returns {number} registros removidos
 */
function forgetTokens(userId, guildId) {
  return guildId ? stmts.remove.run(userId, guildId).changes : stmts.removeAll.run(userId).changes;
}

/** @param {string} userId @returns {string[]} */
function authorizedGuilds(userId) {
  return stmts.listForUser.all(userId).map((row) => row.guild_id);
}

/**
 * Migração da tabela antiga `oauth_users`, que guardava token em texto puro e
 * tinha chave só em `user_id`. As linhas sem `guild_id` são descartadas: sem
 * saber para qual servidor a autorização vale, não há como usá-las.
 */
function migrateLegacyTable() {
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oauth_users'").get();
  if (!legacy) return;

  if (hasEncryptionKey()) {
    const rows = db.prepare('SELECT * FROM oauth_users WHERE guild_id IS NOT NULL').all();
    for (const row of rows) {
      saveTokens({
        userId: row.user_id,
        guildId: row.guild_id,
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: row.expires_at,
      });
    }
    db.exec('DROP TABLE oauth_users');
    console.log(`[oauth] Migração: ${rows.length} token(s) movidos de oauth_users e cifrados.`);
    return;
  }

  // Sem chave não há como cifrar, e manter texto puro no disco é exatamente o
  // que esta mudança existe para acabar. Os usuários reautorizam pelo painel.
  db.exec('DROP TABLE oauth_users');
  console.warn('[oauth] oauth_users removida: OAUTH_TOKEN_KEY não configurada, tokens em texto puro descartados.');
}

migrateLegacyTable();

module.exports = {
  hasEncryptionKey,
  encrypt,
  decrypt,
  saveTokens,
  getTokens,
  forgetTokens,
  authorizedGuilds,
};
