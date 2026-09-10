/**
 * A única porta de entrada para alterar XP.
 *
 * Handler de mensagem, `/add-xp`, `/remove-xp`, `/set-level` e `/reset-xp` todos
 * passam por aqui. Nenhum deles chama um statement de escrita direto, e o motivo é
 * concreto: os limites (nunca negativo, nunca acima do teto) e a derivação do
 * nível precisam existir em **um** lugar. Espalhados por cinco comandos, o quinto
 * esquece um deles.
 *
 * O service não fala com o Discord: não envia mensagem e não mexe em cargo. Ele
 * devolve o que mudou, e quem chamou decide o que anunciar e o que reconciliar.
 * É o que garante que uma falha de anúncio ou de cargo não desfaça XP já gravado.
 */

const repository = require('./repository');
const { MAX_TOTAL_XP, calculateLevelFromXp, totalXpForLevel, clampXp, clampLevel, crossedLevels } = require('./formula');

/** Operações aceitas por `changeXp`. */
const OPERATIONS = Object.freeze(['add', 'remove', 'set']);

/** XP final de uma operação, já dentro dos limites. */
function resolveTarget(operation, previousXp, amount) {
  if (operation === 'add') return Math.min(MAX_TOTAL_XP, previousXp + amount);
  if (operation === 'remove') return Math.max(0, previousXp - amount);
  return clampXp(amount);
}

/**
 * Monta o resultado da alteração com os níveis derivados dos dois XPs.
 * @returns {import('./types').XpChange}
 */
function describeChange(guildId, userId, previousXp, totalXp) {
  const previousLevel = calculateLevelFromXp(previousXp);
  const newLevel = calculateLevelFromXp(totalXp);

  return {
    guildId,
    userId,
    previousXp,
    totalXp,
    delta: totalXp - previousXp,
    previousLevel,
    newLevel,
    direction: newLevel > previousLevel ? 'up' : newLevel < previousLevel ? 'down' : 'same',
    crossedLevels: crossedLevels(previousLevel, newLevel),
  };
}

/**
 * Altera o XP de um usuário num servidor.
 *
 * @param {object} params
 * @param {string} params.guildId
 * @param {string} params.userId
 * @param {'add'|'remove'|'set'} params.operation
 * @param {number} params.amount valor da operação (XP total, no caso de `set`)
 * @param {string} [params.source] origem, só para log de quem chamou
 * @returns {import('./types').XpChange}
 */
function changeXp({ guildId, userId, operation, amount }) {
  if (!guildId || !userId) throw new Error('changeXp exige guildId e userId.');
  if (!OPERATIONS.includes(operation)) throw new Error(`Operação de XP inválida: ${operation}`);

  const value = clampXp(amount);
  const { previousXp, totalXp } = repository.applyXp(guildId, userId, (current) =>
    resolveTarget(operation, current, value)
  );

  return describeChange(guildId, userId, previousXp, totalXp);
}

/**
 * Define o nível do usuário gravando o XP mínimo daquele nível.
 *
 * Não existe coluna `level` para escrever: definir nível **é** definir XP. Quem
 * for posto no nível 10 fica com 0% de progresso dentro dele, que é a leitura
 * previsível de "seu nível agora é 10".
 *
 * @returns {import('./types').XpChange}
 */
function setUserLevel({ guildId, userId, level, source }) {
  return changeXp({
    guildId,
    userId,
    operation: 'set',
    amount: totalXpForLevel(clampLevel(level)),
    source,
  });
}

/** Zera o XP do usuário. @returns {import('./types').XpChange} */
function resetUserXp({ guildId, userId, source }) {
  return changeXp({ guildId, userId, operation: 'set', amount: 0, source });
}

/**
 * Estado atual do usuário, sem gravar nada.
 * @returns {{ totalXp: number, level: number }}
 */
function getUserState(guildId, userId) {
  const totalXp = repository.getXp(guildId, userId);
  return { totalXp, level: calculateLevelFromXp(totalXp) };
}

module.exports = { OPERATIONS, changeXp, setUserLevel, resetUserXp, getUserState, describeChange };
