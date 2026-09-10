// @ts-check
/**
 * Elegibilidade de conteúdo: a mensagem tem texto de verdade ou é farm?
 *
 * O objetivo desta v1 é impedir farm **óbvio** — `.`, `ok`, um emoji, um link
 * solto, a mesma frase dez vezes — sem passar a punir conversa normal. Um filtro
 * mais ambicioso que isso começa a decidir se a conversa é "boa", e aí erra contra
 * quem só escreve curto.
 *
 * A contagem útil desconta menções, URLs e emojis porque nenhum deles é texto que
 * o autor escreveu: colar um link é um caractere de esforço, não trinta. Uma frase
 * de verdade **com** link continua valendo, porque o que sobra depois do desconto
 * ainda passa do mínimo.
 */

const { toPlain } = require('../automod/textNormalize');

/** Teto do texto examinado, para uma mensagem enorme não custar caro. */
const MAX_SCAN_LENGTH = 4000;

/**
 * Prefixos que indicam comando de bot. Um `!` seguido de letra não é conversa.
 *
 * Exatamente **um** caractere de prefixo, não uma sequência: com `+` no lugar do
 * caractere único, "...não sei" e "??que isso" viravam comando e perdiam XP. Um
 * prefixo repetido (`!!play`) escapa e ganha XP, o que é o erro barato dos dois —
 * quase todo bot usa prefixo de um caractere.
 */
const COMMAND_PATTERN = /^[!/.?$%&>+;=,\-*~][\p{L}\p{N}]/u;

/**
 * Texto sem o que não conta como esforço do autor.
 *
 * Ordem importa: os emojis personalizados (`<:nome:id>`) saem antes das menções,
 * porque as duas formas são `<...>` e a regex de menção comeria o nome do emoji
 * deixando o id numérico para trás.
 *
 * @param {string} content
 * @returns {string}
 */
function usefulContent(content) {
  return String(content ?? '')
    .slice(0, MAX_SCAN_LENGTH)
    .replace(/<a?:\w{2,32}:\d{17,20}>/g, ' ')
    .replace(/<(@[!&]?|#)\d{17,20}>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\|\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quantos caracteres úteis a mensagem tem. */
const usefulLength = (content) => usefulContent(content).length;

/**
 * Assinatura de repetição: o texto normalizado.
 *
 * Usa a mesma normalização do AutoMod (minúsculo, sem acento, espaços colapsados),
 * então "OI" e "oi" são a mesma mensagem — que é justamente o que uma trava de
 * repetição precisa enxergar.
 *
 * @param {string} content
 * @returns {string}
 */
const contentSignature = (content) => toPlain(usefulContent(content));

/** A mensagem parece um comando de bot? */
const looksLikeCommand = (content) => COMMAND_PATTERN.test(String(content ?? '').trim());

/**
 * A mensagem pode conceder XP pelo **conteúdo**?
 *
 * Só olha o texto: cooldown, repetição, canal ignorado e cargo ignorado são
 * decisões de outros módulos, com outros dados.
 *
 * @param {string} content
 * @param {{ minUsefulChars: number }} config
 * @returns {{ eligible: boolean, reason: string|null, signature: string }}
 */
function inspectContent(content, { minUsefulChars }) {
  const signature = contentSignature(content);

  if (looksLikeCommand(content)) return { eligible: false, reason: 'comando', signature };
  if (!signature) return { eligible: false, reason: 'sem conteúdo útil', signature };
  if (usefulLength(content) < minUsefulChars) {
    return { eligible: false, reason: 'texto curto', signature };
  }

  return { eligible: true, reason: null, signature };
}

/**
 * Sorteia o XP da mensagem, inclusivo nas duas pontas.
 *
 * @param {{ xpMin: number, xpMax: number }} config
 * @param {() => number} [random] injetável para o teste não depender de sorte
 * @returns {number}
 */
function rollXp({ xpMin, xpMax }, random = Math.random) {
  const min = Math.max(0, Math.trunc(xpMin));
  const max = Math.max(min, Math.trunc(xpMax));
  return min + Math.floor(random() * (max - min + 1));
}

module.exports = {
  MAX_SCAN_LENGTH,
  usefulContent,
  usefulLength,
  contentSignature,
  looksLikeCommand,
  inspectContent,
  rollXp,
};
