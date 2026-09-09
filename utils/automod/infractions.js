/**
 * Pontos de infração e escada de punição.
 *
 * Cada violação grava uma linha em `automod_infractions` com os pontos da regra.
 * A soma dos pontos **não vencidos** decide se um degrau da escada foi cruzado.
 *
 * Linhas nunca são apagadas por expiração: o ponto vencido só sai da soma. Assim
 * o `/infractions` continua mostrando o histórico inteiro do membro, que é o que
 * um moderador quer ver antes de decidir algo manualmente.
 */

const { db } = require('../../database/db');
const { parseSqlDate } = require('../time');

/** Quanto do texto original fica guardado junto da infração. */
const MAX_EXCERPT = 300;

const insertStmt = db.prepare(
  `INSERT INTO automod_infractions
     (guild_id, user_id, rule_key, points, reason, excerpt, channel_id, action)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const listStmt = db.prepare(
  `SELECT * FROM automod_infractions
   WHERE guild_id = ? AND user_id = ?
   ORDER BY created_at DESC, id DESC
   LIMIT ?`
);

const countStmt = db.prepare(
  'SELECT COUNT(*) AS total FROM automod_infractions WHERE guild_id = ? AND user_id = ?'
);

const clearStmt = db.prepare('DELETE FROM automod_infractions WHERE guild_id = ? AND user_id = ?');

/**
 * Registra uma infração.
 * @returns {number} id da linha criada
 */
function recordInfraction({ guildId, userId, ruleKey, points, reason, excerpt, channelId, action }) {
  const result = insertStmt.run(
    guildId,
    userId,
    ruleKey,
    Math.max(0, Number(points) || 0),
    reason ?? null,
    excerpt ? String(excerpt).slice(0, MAX_EXCERPT) : null,
    channelId ?? null,
    action ?? null
  );
  return Number(result.lastInsertRowid);
}

/** Últimas infrações do membro, mais recentes primeiro. */
const listInfractions = (guildId, userId, limit = 10) => listStmt.all(guildId, userId, limit);

/** Total de infrações já registradas, incluindo as vencidas. */
const countInfractions = (guildId, userId) => countStmt.get(guildId, userId).total;

/** Apaga o histórico de um membro (usado pelo `/infractions limpar`). */
const clearInfractions = (guildId, userId) => clearStmt.run(guildId, userId).changes;

/**
 * Soma dos pontos ainda válidos.
 *
 * A janela é calculada em JS em vez de no SQL para não depender do fuso do
 * SQLite: `parseSqlDate` já trata o timestamp como UTC, que é como o banco grava.
 *
 * @param {number} expireHours 0 = pontos nunca vencem
 */
function activePoints(guildId, userId, expireHours, now = Date.now()) {
  const rows = listStmt.all(guildId, userId, 200);
  const cutoff = expireHours > 0 ? now - expireHours * 3600 * 1000 : null;

  return rows.reduce((sum, row) => {
    if (cutoff !== null) {
      const at = parseSqlDate(row.created_at)?.getTime();
      // Sem data legível, o ponto conta: descartar seria premiar um dado corrompido.
      if (at != null && at < cutoff) return sum;
    }
    return sum + row.points;
  }, 0);
}

/**
 * Degrau mais alto cruzado pela pontuação.
 *
 * Só o mais alto é aplicado: com 8 pontos numa escada 3/5/8 o membro leva o
 * degrau de 8, não os três de uma vez.
 *
 * @param {Array<{ points: number, action: string, muteMs?: number }>} ladder já ordenada
 * @returns {{ points: number, action: string, muteMs?: number }|null}
 */
function ladderStep(ladder, points) {
  const crossed = (ladder ?? []).filter((step) => points >= step.points);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

module.exports = {
  MAX_EXCERPT,
  recordInfraction,
  listInfractions,
  countInfractions,
  clearInfractions,
  activePoints,
  ladderStep,
};
