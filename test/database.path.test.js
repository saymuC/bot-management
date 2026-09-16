/**
 * O `DATABASE_PATH` é a única coisa entre o banco e um deploy que apaga tudo em
 * host que sobrescreve a pasta do código. Se ele deixar de ser respeitado, o bot
 * continua subindo — só grava no lugar errado, e ninguém descobre até o deploy
 * seguinte.
 *
 * Roda em processo filho porque o `database/db.js` abre o arquivo no require, e o
 * require é cacheado: dentro da suíte o banco padrão já está aberto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { db } = require('../database/db');
const { getTicketConfig } = require('../utils/tickets/config');
const { getLevelsConfig } = require('../utils/levels/config');

test('DATABASE_PATH manda no arquivo, criando a pasta se não existir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdb-'));
  const target = path.join(dir, 'sub', 'bot.sqlite');
  const dbModule = path.join(__dirname, '..', 'database', 'db.js');

  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(dbModule)})`], {
      env: { ...process.env, DATABASE_PATH: target },
      stdio: 'pipe',
    });

    assert.ok(fs.existsSync(target), 'o banco devia ter sido criado no caminho pedido');
    assert.ok(fs.statSync(target).size > 0, 'o schema devia ter sido aplicado');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function child(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdb-'));
  const target = path.join(dir, 'bot.sqlite');
  const dbModule = path.join(__dirname, '..', 'database', 'db.js');
  try {
    const out = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, DATABASE_PATH: target, DB_MODULE: dbModule },
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return out.trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('migra schema antigo sem colunas novas', () => {
  const out = child(`
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DATABASE_PATH);
    db.exec("CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY); CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT, user_id TEXT NOT NULL, category_label TEXT, status TEXT DEFAULT 'open'); CREATE TABLE giveaways (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, prize TEXT NOT NULL, winners_count INTEGER DEFAULT 1, host_id TEXT, ends_at TEXT NOT NULL, ended INTEGER DEFAULT 0);");
    db.close();
    const { db: migrated } = require(process.env.DB_MODULE);
    console.log(['ticket_config','claimed_at','cancelled'].map((c) => migrated.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(c === 'ticket_config' ? 'guild_config' : c === 'cancelled' ? 'giveaways' : 'tickets', c)?.[1] ?? 0).join(','));
  `);

  assert.equal(out.split('\n').at(-1), '1,1,1');
});

test('foreign keys e constraints recusam dados inválidos', () => {
  assert.throws(
    () => db.prepare('INSERT INTO ticket_ratings (guild_id, ticket_id, agent_id, user_id, stars) VALUES (?, ?, ?, ?, ?)').run('g', 1, 'a', 'u', 6),
    /CHECK constraint failed/
  );

  db.exec('CREATE TABLE IF NOT EXISTS fk_probe_parent (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS fk_probe_child (parent_id INTEGER REFERENCES fk_probe_parent(id));');
  assert.throws(() => db.prepare('INSERT INTO fk_probe_child (parent_id) VALUES (999)').run(), /FOREIGN KEY constraint failed/);
});

test('transação com erro faz rollback', () => {
  db.prepare('DELETE FROM bot_settings WHERE key = ?').run('rollback-probe');
  assert.throws(() => db.transaction(() => {
    db.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?)').run('rollback-probe', 'x');
    throw new Error('boom');
  })(), /boom/);

  assert.equal(db.prepare('SELECT value FROM bot_settings WHERE key = ?').get('rollback-probe'), undefined);
});

test('SQLITE_BUSY aparece com duas conexões no mesmo arquivo', () => {
  const other = new Database(process.env.DATABASE_PATH, { timeout: 1 });
  try {
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => other.prepare('INSERT INTO bot_settings (key, value) VALUES (?, ?)').run('busy-probe', 'x'), /database is locked|SQLITE_BUSY/);
  } finally {
    db.exec('ROLLBACK');
    other.close();
  }
});

test('JSON corrompido em colunas de config cai em defaults', () => {
  const guild = 'json-corrompido';
  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(guild);
  db.prepare('INSERT INTO guild_config (guild_id, ticket_config, levels_config) VALUES (?, ?, ?)').run(guild, '{', '{');

  assert.equal(getTicketConfig(guild).enabled, true);
  assert.equal(getLevelsConfig(guild).enabled, false);

  db.prepare('DELETE FROM guild_config WHERE guild_id = ?').run(guild);
});
