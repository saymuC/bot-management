const path = require('node:path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'bot.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id TEXT PRIMARY KEY,
  welcome_channel_id TEXT,
  welcome_message TEXT,
  welcome_config TEXT,
  log_channel_id TEXT,
  ticket_category_id TEXT,
  ticket_panel_channel_id TEXT,
  ticket_log_channel_id TEXT,
  verify_channel_id TEXT,
  verify_role_id TEXT,
  verify_panel TEXT,
  automod_config TEXT,
  autorole_id TEXT,
  mute_role_id TEXT
);

-- Configuração global do bot (não é por servidor). Ex.: presença/status.
CREATE TABLE IF NOT EXISTS bot_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ticket_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT,
  target_category_id TEXT,
  support_role_id TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT,
  user_id TEXT NOT NULL,
  category_label TEXT,
  status TEXT DEFAULT 'open',
  claimed_by TEXT,
  claimed_at TEXT,
  closed_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS ticket_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  ticket_id INTEGER NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Infrações do AutoMod. As linhas nunca são apagadas por expiração: os pontos
-- vencidos só ficam de fora da soma da escada, e o histórico segue consultável.
CREATE TABLE IF NOT EXISTS automod_infractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  excerpt TEXT,
  channel_id TEXT,
  action TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  prize TEXT NOT NULL,
  winners_count INTEGER DEFAULT 1,
  host_id TEXT,
  ends_at TEXT NOT NULL,
  ended INTEGER DEFAULT 0,
  cancelled INTEGER DEFAULT 0,
  cancelled_by TEXT
);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS reaction_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  role_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_user ON tickets (guild_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_claimed ON tickets (guild_id, claimed_by);
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_agent ON ticket_ratings (guild_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_warns_guild_user ON warns (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_automod_infractions_user ON automod_infractions (guild_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reaction_roles_message ON reaction_roles (message_id);
CREATE INDEX IF NOT EXISTS idx_giveaways_pending ON giveaways (ended, ends_at);
`);

/**
 * Migrações de coluna: o CREATE TABLE IF NOT EXISTS acima não altera tabelas
 * que já existem, então bancos criados antes destas features precisam do ALTER.
 * Idempotente — consulta o schema atual antes de mexer.
 */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[db] Migração: ${table}.${column} adicionada.`);
}

ensureColumn('guild_config', 'ticket_log_channel_id', 'TEXT');
ensureColumn('guild_config', 'welcome_config', 'TEXT');
ensureColumn('guild_config', 'emoji_config', 'TEXT');
ensureColumn('guild_config', 'verify_panel', 'TEXT');
ensureColumn('guild_config', 'automod_config', 'TEXT');
ensureColumn('tickets', 'claimed_at', 'TEXT');
ensureColumn('tickets', 'closed_by', 'TEXT');
ensureColumn('giveaways', 'cancelled', 'INTEGER DEFAULT 0');
ensureColumn('giveaways', 'cancelled_by', 'TEXT');

// ---- guild_config ----
const upsertConfigField = (field) =>
  db.prepare(
    `INSERT INTO guild_config (guild_id, ${field}) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET ${field} = excluded.${field}`
  );

// campos permitidos — nunca interpolar entrada do usuário aqui
const CONFIG_FIELDS = [
  'welcome_channel_id', 'welcome_message', 'welcome_config', 'emoji_config', 'log_channel_id',
  'ticket_category_id', 'ticket_panel_channel_id', 'ticket_log_channel_id',
  'verify_channel_id', 'verify_role_id', 'verify_panel', 'automod_config', 'autorole_id', 'mute_role_id',
];
const configSetters = Object.fromEntries(CONFIG_FIELDS.map((f) => [f, upsertConfigField(f)]));

function setGuildConfig(guildId, field, value) {
  const stmt = configSetters[field];
  if (!stmt) throw new Error(`Campo de configuração inválido: ${field}`);
  stmt.run(guildId, value);
}

const getGuildConfigStmt = db.prepare('SELECT * FROM guild_config WHERE guild_id = ?');
function getGuildConfig(guildId) {
  return getGuildConfigStmt.get(guildId) ?? null;
}

// ---- bot_settings (chave/valor global) ----
const setBotSettingStmt = db.prepare(
  `INSERT INTO bot_settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);
const getBotSettingStmt = db.prepare('SELECT value FROM bot_settings WHERE key = ?');

function setBotSetting(key, value) {
  setBotSettingStmt.run(key, value);
}

/** @returns {string|null} */
function getBotSetting(key) {
  return getBotSettingStmt.get(key)?.value ?? null;
}

module.exports = { db, setGuildConfig, getGuildConfig, setBotSetting, getBotSetting };
