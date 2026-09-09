/**
 * Padrões com curinga `*` para o filtro de conteúdo.
 *
 * Deliberadamente **não** é regex. Um admin colando `(a+)+$` num campo de texto
 * travaria o processo inteiro por backtracking catastrófico, e o Node não tem
 * como interromper uma RegExp em execução — não haveria conserto depois.
 *
 * Em vez disso o padrão é quebrado em segmentos pelos `*` e procurado em ordem
 * com `indexOf`. Isso avança sempre para a frente, nunca volta atrás, e por
 * isso não tem pior caso explosivo: o custo é limitado pelo tamanho do texto
 * vezes o número de segmentos. Cobre o que se pede na prática
 * (`ganhe*nitro*gratis`) sem a classe de falha inteira.
 */

const { toPlain } = require('./textNormalize');

/** Tetos para o padrão do usuário — nenhum caso legítimo se aproxima disso. */
const MAX_PATTERN_LENGTH = 200;
const MAX_SEGMENTS = 10;

/**
 * Compila um padrão em uma função de teste.
 *
 * @param {string} pattern texto com zero ou mais `*`
 * @returns {((text: string) => boolean)|null} null se o padrão for inútil ou grande demais
 */
function compileWildcard(pattern) {
  const source = String(pattern ?? '').trim().slice(0, MAX_PATTERN_LENGTH);
  if (!source) return null;

  // `*` nas pontas é redundante: a busca já é por "contém".
  const segments = toPlain(source)
    .split('*')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length || segments.length > MAX_SEGMENTS) return null;

  return (text) => {
    const haystack = toPlain(text);
    let cursor = 0;

    for (const segment of segments) {
      const found = haystack.indexOf(segment, cursor);
      if (found === -1) return false;
      cursor = found + segment.length;
    }
    return true;
  };
}

/**
 * Compila uma lista de padrões, descartando os inválidos.
 * @returns {Array<{ pattern: string, test: (text: string) => boolean }>}
 */
function compilePatterns(patterns) {
  const list = Array.isArray(patterns) ? patterns : [];
  return list
    .map((pattern) => ({ pattern, test: compileWildcard(pattern) }))
    .filter((entry) => entry.test !== null);
}

module.exports = { MAX_PATTERN_LENGTH, MAX_SEGMENTS, compileWildcard, compilePatterns };
