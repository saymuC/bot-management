/**
 * Pontos de infração e escada de punição.
 *
 * Cada violação grava uma linha em `automod_infractions` com os pontos da regra.
 * A soma dos pontos **não vencidos** decide se um degrau da escada foi cruzado.
 *
 * A expiração tira pontos da soma; a retenção remove apenas linhas antigas
 * cujos pontos também já venceram.
 */

const { db } = require('../../database/db');
const { getAutomodConfig } = require('./config');

/** Quanto do texto original fica guardado junto da infração. */
const MAX_EXCERPT = 120;
const retentionSetting = process.env.AUTOMOD_RETENTION_DAYS;
const RETENTION_DAYS = retentionSetting === undefined ? 90 : Number(retentionSetting);
if ((retentionSetting !== undefined && !/^\d+$/.test(retentionSetting)) ||
    !Number.isSafeInteger(RETENTION_DAYS) || RETENTION_DAYS > 36500) {
  throw new Error('AUTOMOD_RETENTION_DAYS deve ser um inteiro entre 0 e 36500');
}

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
const guildsStmt = db.prepare('SELECT DISTINCT guild_id FROM automod_infractions');
const purgeStmt = db.prepare(
  `DELETE FROM automod_infractions WHERE guild_id = ? AND created_at < ?
   AND created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'`
);

/**
 * Soma no banco, não em JS: carregar as linhas para somar impunha um teto (eram
 * 200) que fazia a pontuação de um reincidente **cair** silenciosamente ao passar
 * dele. `COALESCE` porque `SUM` de nada é `NULL`.
 *
 * `created_at IS NULL OR created_at >= ?` mantém o critério antigo de contar o
 * ponto com data ilegível: descartar seria premiar um dado corrompido.
 */
const sumAllStmt = db.prepare(
  `SELECT COALESCE(SUM(points), 0) AS total FROM automod_infractions
   WHERE guild_id = ? AND user_id = ?`
);

const sumActiveStmt = db.prepare(
  `SELECT COALESCE(SUM(points), 0) AS total FROM automod_infractions
   WHERE guild_id = ? AND user_id = ? AND (created_at IS NULL OR created_at >= ?)`
);

/**
 * Timestamp no formato exato que o SQLite grava (`CURRENT_TIMESTAMP`, em UTC),
 * para a comparação de texto do `>=` bater com a ordem cronológica.
 */
const toSqlDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

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

/** 0 desliga a retenção; pontos sem expiração nunca são removidos. */
function purgeExpiredInfractions(now = Date.now()) {
  if (!RETENTION_DAYS) return 0;
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const { guild_id: guildId } of guildsStmt.all()) {
    const hours = getAutomodConfig(guildId).pointsExpireHours;
    if (!(hours > 0)) continue;
    removed += purgeStmt.run(guildId, toSqlDate(Math.min(cutoff, now - hours * 3_600_000))).changes;
  }
  return removed;
}

// Uma limpeza no boot e depois diariamente; nunca atrasa o encerramento do processo.
purgeExpiredInfractions();
setInterval(purgeExpiredInfractions, 86_400_000).unref();

/**
 * Soma dos pontos ainda válidos. Conta **todas** as infrações do membro, sem teto.
 *
 * @param {number} expireHours 0 = pontos nunca vencem
 */
function activePoints(guildId, userId, expireHours, now = Date.now()) {
  if (!(expireHours > 0)) return sumAllStmt.get(guildId, userId).total;

  const cutoff = toSqlDate(now - expireHours * 3600 * 1000);
  return sumActiveStmt.get(guildId, userId, cutoff).total;
}

/**
 * Degrau em que a pontuação **está** — o mais alto já alcançado.
 *
 * Serve para exibição (`/infractions` mostra "degrau atual"). Para decidir se há
 * punição a aplicar, use `crossedStep`: este aqui devolve o mesmo degrau enquanto
 * os pontos ficam entre dois limiares, e aplicá-lo a cada infração repetiria a
 * punição sem o membro ter avançado nada.
 *
 * @param {Array<{ points: number, action: string, muteMs?: number }>} ladder já ordenada
 * @returns {{ points: number, action: string, muteMs?: number }|null}
 */
function ladderStep(ladder, points) {
  const reached = (ladder ?? []).filter((step) => points >= step.points);
  return reached.length ? reached[reached.length - 1] : null;
}

/**
 * Degrau **cruzado agora**, ou null se a infração não passou por limiar nenhum.
 *
 * A diferença importa: numa escada 3/5/8/12, um membro que vai de 6 para 7 pontos
 * não cruzou nada — o degrau de 5 ele já pagou. Sem esta distinção, cada nova
 * infração reaplicava o mesmo mute de 1h indefinidamente.
 *
 * Quando um único evento passa por mais de um limiar (2 → 7 cruza 3 e 5), vale o
 * mais alto: é a mesma lógica de "só o mais alto é aplicado" de antes.
 *
 * @param {number} before pontos antes desta infração
 * @param {number} after pontos depois
 */
function crossedStep(ladder, before, after) {
  if (!(after > before)) return null;

  const crossed = (ladder ?? []).filter((step) => step.points > before && step.points <= after);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

module.exports = {
  MAX_EXCERPT,
  toSqlDate,
  recordInfraction,
  listInfractions,
  countInfractions,
  clearInfractions,
  purgeExpiredInfractions,
  activePoints,
  ladderStep,
  crossedStep,
};
