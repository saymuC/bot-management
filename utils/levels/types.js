// @ts-check
/**
 * Contratos compartilhados do módulo de Levels/XP.
 *
 * Só typedefs: o arquivo não exporta nada em runtime. Serve para os módulos
 * novos poderem escrever `@param {import('./types').LevelsConfig}` em vez de
 * repetir a forma do objeto em cada JSDoc.
 */

/**
 * @typedef {'stack'|'highest'} RewardMode
 */

/**
 * @typedef {Object} LevelReward
 * @property {number} level nível a partir do qual os cargos valem
 * @property {string[]} roleIds um ou mais cargos concedidos nesse nível
 */

/**
 * @typedef {Object} LevelsConfig
 * @property {boolean} enabled
 * @property {number} xpMin
 * @property {number} xpMax
 * @property {number} cooldownSeconds
 * @property {number} minUsefulChars
 * @property {number} repeatWindowSeconds
 * @property {string[]} ignoredChannelIds
 * @property {string[]} ignoredRoleIds
 * @property {boolean} announceEnabled
 * @property {string|null} announceChannelId canal fixo, ou null para o canal da mensagem
 * @property {RewardMode} rewardMode
 * @property {LevelReward[]} rewards ordenadas por nível crescente
 */

/**
 * @typedef {Object} XpProgress
 * @property {number} level
 * @property {number} totalXp
 * @property {number} xpIntoLevel XP já acumulado dentro do nível atual
 * @property {number} xpForNextLevel XP que o nível atual exige para avançar (0 no teto)
 * @property {number} percent 0 a 1
 */

/**
 * @typedef {'up'|'down'|'same'} XpDirection
 */

/**
 * @typedef {Object} XpChange
 * @property {string} guildId
 * @property {string} userId
 * @property {number} previousXp
 * @property {number} totalXp
 * @property {number} delta
 * @property {number} previousLevel
 * @property {number} newLevel
 * @property {XpDirection} direction
 * @property {number[]} crossedLevels níveis atravessados, na ordem em que foram cruzados
 */

module.exports = {};
