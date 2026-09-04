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
  log_channel_id TEXT,
  ticket_category_id TEXT,
  ticket_panel_channel_id TEXT,
  verify_channel_id TEXT,
  verify_role_id TEXT,
  autorole_id TEXT,
  mute_role_id TEXT
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS warns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT,
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
  ended INTEGER DEFAULT 0
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
CREATE INDEX IF NOT EXISTS idx_warns_guild_user ON warns (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_reaction_roles_message ON reaction_roles (message_id);
CREATE INDEX IF NOT EXISTS idx_giveaways_pending ON giveaways (ended, ends_at);
`);

// ---- guild_config ----
const upsertConfigField = (field) =>
  db.prepare(
    `INSERT INTO guild_config (guild_id, ${field}) VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET ${field} = excluded.${field}`
  );

// campos permitidos — nunca interpolar entrada do usuário aqui
const CONFIG_FIELDS = [
  'welcome_channel_id', 'welcome_message', 'log_channel_id',
  'ticket_category_id', 'ticket_panel_channel_id',
  'verify_channel_id', 'verify_role_id', 'autorole_id', 'mute_role_id',
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

module.exports = { db, setGuildConfig, getGuildConfig };
