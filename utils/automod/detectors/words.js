/**
 * Detectores da família "palavras proibidas".
 *
 * `words` usa `matchesTerm`, que já resolve acento, leetspeak, repetição e
 * separadores no meio da palavra. `patterns` usa o curinga `*` compilado por
 * `wildcard.js` — nunca regex vinda do usuário.
 *
 * O trecho devolvido no `detail` é o termo que casou, não a mensagem: o texto
 * completo vai para o campo `excerpt` da infração, e repetir o insulto no aviso
 * público só espalharia o que se quer apagar.
 */

const { matchesTerm } = require('../textNormalize');
const { compilePatterns } = require('../wildcard');

const detectors = {
  words({ content }, limits) {
    if (!limits.words.length) return null;

    const options = { wholeWord: limits.wholeWord, unmask: limits.unmask };
    const hit = limits.words.find((word) => matchesTerm(content, word, options));
    if (!hit) return null;

    return { detail: `palavra proibida: "${hit}"` };
  },

  patterns({ content }, limits) {
    if (!limits.patterns.length) return null;

    const hit = compilePatterns(limits.patterns).find((entry) => entry.test(content));
    if (!hit) return null;

    return { detail: `padrão proibido: "${hit.pattern}"` };
  },
};

module.exports = { detectors };
