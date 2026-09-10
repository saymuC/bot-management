/**
 * Acesso a `user_levels`. Só SQL — nada de Discord e nada de regra de negócio.
 *
 * Os statements são preparados uma vez, no carregamento do módulo: eles rodam a
 * cada mensagem elegível do servidor, e `db.prepare` dentro da função pagaria a
 * compilação da query toda vez.
 *
 * A alteração de XP é sempre uma transação (`applyXp`), nunca um UPDATE solto.
 * Ler e escrever em duas chamadas separadas abriria a janela clássica de perda de
 * atualização: duas mensagens do mesmo usuário processadas em sequência lendo o
 * mesmo XP anterior e gravando o mesmo XP final, com uma das duas concessões
 * desaparecendo. Como `better-sqlite3` é síncrono, a transação fecha essa janela
 * dentro do processo.
 */

const { db } = require('../../database/db');

const selectXpStmt = db.prepare('SELECT xp FROM user_levels WHERE guild_id = ? AND user_id = ?');

const upsertXpStmt = db.prepare(
  `INSERT INTO user_levels (guild_id, user_id, xp) VALUES (?, ?, ?)
   ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, updated_at = CURRENT_TIMESTAMP`
);

const leaderboardStmt = db.prepare(
  `SELECT user_id, xp FROM user_levels
   WHERE guild_id = ?
   ORDER BY xp DESC, user_id ASC
   LIMIT ? OFFSET ?`
);

// O desempate por `user_id` tem de ser o mesmo do leaderboard, senão o /rank
// mostra uma posição que o /top não confirma quando há empate de XP.
const rankStmt = db.prepare(
  `SELECT COUNT(*) + 1 AS position FROM user_levels
   WHERE guild_id = ?
     AND (xp > ? OR (xp = ? AND user_id < ?))`
);

const countStmt = db.prepare('SELECT COUNT(*) AS total FROM user_levels WHERE guild_id = ?');
const deleteRowStmt = db.prepare('DELETE FROM user_levels WHERE guild_id = ? AND user_id = ?');
const deleteGuildStmt = db.prepare('DELETE FROM user_levels WHERE guild_id = ?');

/**
 * XP atual do usuário. Zero quando não há registro — consultar não cria linha.
 * @returns {number}
 */
function getXp(guildId, userId) {
  return selectXpStmt.get(guildId, userId)?.xp ?? 0;
}

/**
 * Altera o XP de forma atômica.
 *
 * O chamador não informa o XP final: informa **como** calculá-lo a partir do
 * anterior. É o que permite o `+15` continuar sendo `+15` mesmo que outra
 * gravação tenha entrado no meio, em vez de sobrescrever com um valor calculado
 * sobre uma leitura velha.
 *
 * @param {string} guildId
 * @param {string} userId
 * @param {(previousXp: number) => number} resolve devolve o novo XP total
 * @returns {{ previousXp: number, totalXp: number }}
 */
const applyXp = db.transaction((guildId, userId, resolve) => {
  const previousXp = getXp(guildId, userId);
  const totalXp = resolve(previousXp);

  // Sem escrita quando nada muda: poupa um UPSERT (e um WAL write) no caso comum
  // de `/add-xp 0` ou de um reset em quem já estava zerado.
  if (totalXp !== previousXp) upsertXpStmt.run(guildId, userId, totalXp);

  return { previousXp, totalXp };
});

/**
 * Página do leaderboard, do maior XP para o menor.
 * @returns {{ user_id: string, xp: number }[]}
 */
function leaderboardPage(guildId, limit, offset) {
  return leaderboardStmt.all(guildId, Math.max(0, limit), Math.max(0, offset));
}

/**
 * Posição do usuário no servidor (1 = primeiro).
 *
 * Quem não tem registro tem 0 de XP e recebe a posição correspondente a isso, sem
 * ganhar uma linha no banco só por ter sido consultado.
 *
 * @returns {number}
 */
function rankOf(guildId, userId, xp = getXp(guildId, userId)) {
  return rankStmt.get(guildId, xp, xp, userId).position;
}

/** Quantos usuários o servidor tem no ranking. */
function participantCount(guildId) {
  return countStmt.get(guildId).total;
}

/** Apaga o registro do usuário. Usado quando o reset zera quem não tinha XP. */
function deleteUser(guildId, userId) {
  return deleteRowStmt.run(guildId, userId).changes;
}

/** Apaga o ranking inteiro do servidor. */
function deleteGuild(guildId) {
  return deleteGuildStmt.run(guildId).changes;
}

module.exports = {
  getXp,
  applyXp,
  leaderboardPage,
  rankOf,
  participantCount,
  deleteUser,
  deleteGuild,
};
