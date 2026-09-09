/**
 * Normalização de texto para o filtro de palavras.
 *
 * O problema real de um filtro de palavras não é achar a palavra escrita certo —
 * é achar `p4l4vr4`, `p-a-l-a-v-r-a`, `pállávrá` e `paaalavra` sem passar a
 * castigar quem escreveu "assistir". Por isso são geradas duas formas:
 *
 *   plain    — minúsculo, sem acentos, espaços colapsados. Aceita busca por
 *              palavra inteira, porque os limites de palavra continuam de pé.
 *   unmasked — plain + leetspeak desfeito + repetições colapsadas + todo
 *              caractere que não é letra ou número removido. Some com os
 *              limites de palavra, então aqui a busca é por conter.
 *
 * Como a forma desmascarada gruda tudo, ela é aplicada só a termos com pelo
 * menos MIN_UNMASK_LENGTH caracteres: em termos curtos a chance de cair dentro
 * de uma palavra inocente é grande demais para valer a troca.
 */

/** Abaixo disto, um termo só é procurado na forma `plain`. */
const MIN_UNMASK_LENGTH = 4;

/** Teto do texto examinado, para uma mensagem enorme não custar caro. */
const MAX_SCAN_LENGTH = 4000;

/**
 * Substituições de leetspeak. Só as que aparecem de verdade em burla —
 * um mapa ambicioso demais gera falso positivo em texto normal.
 */
const LEET_MAP = Object.freeze({
  '4': 'a', '@': 'a', '3': 'e', '1': 'i', '!': 'i', '|': 'i',
  '0': 'o', '5': 's', '$': 's', '7': 't', '+': 't', '9': 'g', '8': 'b',
});

/** Tira acentos e diacríticos, preservando a letra base. */
const stripDiacritics = (text) => text.normalize('NFD').replace(/\p{M}+/gu, '');

/** Minúsculo, sem acento, espaços colapsados. Os limites de palavra sobrevivem. */
function toPlain(text) {
  return stripDiacritics(String(text ?? '').slice(0, MAX_SCAN_LENGTH).toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Forma desmascarada: desfaz leetspeak, colapsa letra repetida e remove tudo
 * que não é letra ou número (espaços, pontos, hífens, asteriscos, emojis).
 */
function toUnmasked(text) {
  const plain = toPlain(text);
  const deleeted = plain.replace(/[4@31!|05$7+98]/g, (char) => LEET_MAP[char] ?? char);

  return deleeted
    // "paaalavra" -> "palavra". Duas ocorrências viram uma só, o que também
    // achata "aa" legítimo — aceitável, já que o termo procurado passa pela
    // mesma normalização e portanto também fica achatado.
    .replace(/(.)\1{1,}/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Escapa uma string para usar dentro de uma RegExp. */
const escapeRegex = (text) => String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Procura um termo no texto.
 *
 * @param {string} content mensagem original
 * @param {string} term termo proibido, como o admin escreveu
 * @param {{ wholeWord?: boolean, unmask?: boolean }} options
 * @returns {boolean}
 */
function matchesTerm(content, term, { wholeWord = true, unmask = true } = {}) {
  const plainTerm = toPlain(term);
  if (!plainTerm) return false;

  const plainContent = toPlain(content);

  // Frase com espaço nunca casa com \b nas duas pontas de forma útil; trata-se
  // como sequência literal, que é o que o admin espera ao escrever uma frase.
  const pattern = wholeWord && !plainTerm.includes(' ')
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(plainTerm)}(?![\\p{L}\\p{N}])`, 'u')
    : new RegExp(escapeRegex(plainTerm), 'u');

  if (pattern.test(plainContent)) return true;
  if (!unmask) return false;

  const unmaskedTerm = toUnmasked(term);
  if (unmaskedTerm.length < MIN_UNMASK_LENGTH) return false;

  return toUnmasked(content).includes(unmaskedTerm);
}

/**
 * Proporção de caracteres em caixa alta entre as letras do texto.
 * Ignora números e pontuação, que não têm caixa e diluiriam a conta.
 * @returns {number} 0 a 1
 */
function capsRatio(text) {
  const letters = String(text ?? '').match(/\p{L}/gu);
  if (!letters?.length) return 0;
  const upper = letters.filter((char) => char !== char.toLowerCase() && char === char.toUpperCase());
  return upper.length / letters.length;
}

/**
 * Densidade de acentos combinantes — a assinatura do zalgo.
 * Texto em português tem poucos; zalgo empilha vários por letra.
 * @returns {number} 0 a 1
 */
function zalgoRatio(text) {
  const raw = String(text ?? '').slice(0, MAX_SCAN_LENGTH).normalize('NFD');
  if (!raw.length) return 0;
  return (raw.match(/\p{M}/gu)?.length ?? 0) / raw.length;
}

/** Conta emojis unicode e personalizados (`<:nome:id>`) na mensagem. */
function countEmojis(text) {
  const content = String(text ?? '').slice(0, MAX_SCAN_LENGTH);
  const custom = content.match(/<a?:\w{2,32}:\d{17,20}>/g)?.length ?? 0;
  // Sem o custom no meio, para o id numérico do emoji não contar como dígito solto.
  const unicode = content.replace(/<a?:\w{2,32}:\d{17,20}>/g, '').match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  return custom + unicode;
}

/** Conta blocos ||spoiler|| fechados. */
const countSpoilers = (text) => String(text ?? '').match(/\|\|[^|]+\|\|/g)?.length ?? 0;

module.exports = {
  MIN_UNMASK_LENGTH,
  MAX_SCAN_LENGTH,
  LEET_MAP,
  stripDiacritics,
  toPlain,
  toUnmasked,
  escapeRegex,
  matchesTerm,
  capsRatio,
  zalgoRatio,
  countEmojis,
  countSpoilers,
};
