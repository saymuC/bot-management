/**
 * Registry dos detectores de mensagem.
 *
 * Percorre as regras na ordem declarada em `config/automodRules.js` (barato →
 * caro) e devolve a **primeira** violação. Parar na primeira é intencional: uma
 * mensagem em caixa alta com link e palavrão renderia três punições e o triplo
 * de pontos sem que o admin tivesse pedido isso.
 */

const { MESSAGE_RULE_KEYS, RULES } = require('../../../config/automodRules');
const { exemptionReason } = require('../config');
const { detectors: excess } = require('./excess');
const { detectors: media } = require('./media');
const { detectors: links } = require('./links');
const { detectors: words } = require('./words');
const { detectors: flood } = require('./flood');

/** `ruleKey` -> função de checagem. Pode ser sync ou async. */
const CHECKS = Object.freeze({ ...excess, ...media, ...links, ...words, ...flood });

/** Toda regra do catálogo tem detector? Erra alto no boot, não silenciosamente em produção. */
const missing = MESSAGE_RULE_KEYS.filter((key) => typeof CHECKS[key] !== 'function');
if (missing.length) throw new Error(`[automod] regras sem detector: ${missing.join(', ')}`);

/**
 * Avalia a mensagem contra as regras ligadas.
 *
 * @param {object} ctx contexto montado pelo motor: { content, signature, message,
 *   member, guild, channelId, attachmentFiles, attachmentNames, attachments,
 *   stickers, now }
 * @param {object} config config normalizada do AutoMod do servidor
 * @returns {Promise<{ key: string, rule: object, label: string, detail: string }|null>}
 */
async function findViolation(ctx, config) {
  for (const key of MESSAGE_RULE_KEYS) {
    const rule = config.rules[key];
    if (!rule?.enabled) continue;

    // Isenção é checada por regra, não uma vez só: cada regra tem as suas, e o
    // canal isento de "links" pode continuar valendo para "palavras".
    if (exemptionReason(config, rule, ctx.member, ctx.channelId)) continue;

    // eslint-disable-next-line no-await-in-loop -- a ordem é o comportamento: para na 1ª violação
    const hit = await CHECKS[key](ctx, rule.limits);
    if (hit) return { key, rule, label: RULES[key].label, detail: hit.detail };
  }

  return null;
}

module.exports = { CHECKS, findViolation };
