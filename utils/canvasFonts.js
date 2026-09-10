// @ts-check
/**
 * Descoberta das fontes do sistema para tudo que o bot desenha em canvas.
 *
 * Em host Linux enxuto (container sem pacote de fontes) o `@napi-rs/canvas` não
 * registra nenhuma família e todo texto sai em branco — a imagem é gerada, só
 * está vazia. Por isso quem desenha pergunta antes, e quem não tem fonte cai
 * numa alternativa em texto em vez de mandar um PNG ilegível.
 *
 * Três papéis, porque o card do ranking usa três tipografias: título, corpo e
 * números. Só nomes reais entram nas listas — `sans-serif` e companhia são
 * genéricos do CSS e nunca aparecem em `GlobalFonts.families`, então testá-los
 * seria uma condição que nunca dá certo.
 */

const path = require('node:path');
const fs = require('node:fs');
const { GlobalFonts } = require('@napi-rs/canvas');

/**
 * Fontes que viajam com o projeto, em `assets/fonts/`.
 *
 * A Klee One é a identidade das imagens do ranking, e depender de instalação no
 * host seria depender de sorte: em container Debian ela não existe, e o card
 * sairia com a fonte que sobrasse. Registrada daqui, o `/top` sai igual em
 * qualquer máquina — e de graça vem a cobertura de japonês, que as fontes de
 * sistema latinas não têm.
 *
 * O registro é feito uma vez, no carregamento do módulo. Falha não é fatal: sem a
 * fonte embutida a descoberta abaixo continua achando uma do sistema.
 */
const STRONG_FAMILY = 'Klee One Semi';

const BUNDLED_FONTS = Object.freeze([
  { file: 'KleeOne-Regular.ttf', alias: 'Klee One' },
  // O SemiBold entra com nome próprio, não como segundo peso do mesmo nome: o
  // `bold` do `ctx.font` sobre a Klee One engorda o traço por conta própria e sai
  // borrado. Com alias separado quem desenha escolhe o peso de verdade.
  { file: 'KleeOne-SemiBold.ttf', alias: STRONG_FAMILY },
]);

/** @returns {string[]} aliases registrados com sucesso */
function registerBundledFonts() {
  const dir = path.join(__dirname, '..', 'assets', 'fonts');
  const registered = [];

  for (const { file, alias } of BUNDLED_FONTS) {
    const full = path.join(dir, file);
    try {
      if (!fs.existsSync(full)) continue;
      if (GlobalFonts.registerFromPath(full, alias)) registered.push(alias);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      console.error(`[fonts] não foi possível registrar ${file}:`, motivo);
    }
  }

  return registered;
}

const BUNDLED_REGISTERED = registerBundledFonts();

/** Preferência de cada papel, da mais desejada para a mais provável de existir. */
const FAMILY_CANDIDATES = Object.freeze({
  /** Títulos: serifa, o traço do mockup do ranking. */
  display: Object.freeze([
    'Klee One',
    'Georgia',
    'Palatino Linotype',
    'Book Antiqua',
    'Times New Roman',
    'Noto Serif',
    'DejaVu Serif',
    'Liberation Serif',
  ]),
  /** Corpo: a mesma Klee One, com as sans do sistema como reserva. */
  body: Object.freeze([
    'Klee One',
    'Segoe UI',
    'Inter',
    'Noto Sans',
    'DejaVu Sans',
    'Liberation Sans',
    'Arial',
    'Helvetica',
    'Verdana',
  ]),
  /** Números: monoespaçada, para as colunas de XP ficarem alinhadas. */
  mono: Object.freeze([
    'Consolas',
    'Cascadia Mono',
    'JetBrains Mono',
    'Noto Sans Mono',
    'DejaVu Sans Mono',
    'Liberation Mono',
    'Courier New',
  ]),
});

/**
 * Fontes de reserva por glifo, na ordem em que o Skia deve tentá-las.
 *
 * Sem isto, um apelido em japonês, em árabe ou com emoji sai como uma fileira de
 * quadradinhos: a fonte de corpo cobre latino e desiste do resto. O Skia faz
 * fallback por caractere quando a lista de famílias tem mais de um nome, então o
 * custo é só escrever a lista.
 */
const FALLBACK_CANDIDATES = Object.freeze([
  'Segoe UI Emoji',
  'Noto Color Emoji',
  'Apple Color Emoji',
  'Segoe UI Symbol',
  'Yu Gothic UI',
  'Meiryo',
  'Noto Sans CJK JP',
  'Noto Sans JP',
  'Microsoft YaHei',
  'Malgun Gothic',
  'Noto Sans Arabic',
  'Noto Sans Hebrew',
  'Noto Sans Thai',
  'Arial Unicode MS',
]);

/** @typedef {'display'|'body'|'mono'} FontRole */

/** @typedef {{ display: string, body: string, mono: string }} FontFamilies */

const MISSING_REASON =
  'Nenhuma fonte do sistema encontrada — as imagens sairiam em branco. ' +
  'Instale um pacote de fontes no host (ex.: `apt-get install fonts-dejavu-core`).';

/** Famílias registradas no processo. */
const availableFamilies = () => new Set(GlobalFonts.families.map((entry) => entry.family));

/**
 * Primeira família instalada para o papel, ou `null`.
 * @param {FontRole} role
 * @param {Set<string>} [available]
 * @returns {string|null}
 */
function resolveFamily(role, available = availableFamilies()) {
  const candidates = FAMILY_CANDIDATES[role] ?? FAMILY_CANDIDATES.body;
  return candidates.find((family) => available.has(family)) ?? null;
}

/**
 * As três famílias, ou `null` se o host não tem fonte nenhuma.
 *
 * Um papel sem candidata instalada cai no corpo: um título em sans é uma perda
 * estética, um título invisível é um defeito.
 *
 * @returns {FontFamilies|null}
 */
function resolveFamilies(available = availableFamilies()) {
  const body = resolveFamily('body', available) ?? resolveFamily('display', available) ?? resolveFamily('mono', available);
  if (!body) return null;

  return {
    display: resolveFamily('display', available) ?? body,
    body,
    mono: resolveFamily('mono', available) ?? body,
  };
}

/**
 * As famílias já no formato de `ctx.font`, com as reservas por glifo no fim.
 *
 * Devolve a lista pronta (`"Klee One", "Segoe UI Emoji", …`) em vez do nome
 * simples justamente para quem monta a string não ter de lembrar de aspas nem de
 * fallback — o card usa isto, o captcha continua com o nome único.
 *
 * `strong` + `weight` andam juntos e resolvem o mesmo problema por dois caminhos:
 * com a Klee One embutida existe um peso mais forte de verdade e `weight` vem
 * vazio; num host que só tem fonte de sistema, `strong` é a própria fonte de corpo
 * e `weight` vira `'bold '`. Quem desenha escreve sempre
 * `${weight}20px ${strong}` e não precisa saber em qual dos dois mundos está.
 *
 * @param {Set<string>} [available]
 * @returns {(FontFamilies & { strong: string, weight: string })|null}
 */
function fontStacks(available = availableFamilies()) {
  const families = resolveFamilies(available);
  if (!families) return null;

  const extras = FALLBACK_CANDIDATES.filter((family) => available.has(family));
  const stack = (...names) => [...new Set([...names, ...extras])].map((name) => `"${name}"`).join(', ');

  const hasStrong = available.has(STRONG_FAMILY);

  return {
    display: stack(families.display, families.body),
    body: stack(families.body),
    mono: stack(families.mono, families.body),
    strong: hasStrong ? stack(STRONG_FAMILY, families.body) : stack(families.body),
    weight: hasStrong ? '' : 'bold ',
  };
}

/**
 * Diagnóstico para o boot e para os painéis.
 * @returns {{ ok: true, families: FontFamilies }|{ ok: false, reason: string }}
 */
function checkCanvasFonts() {
  const families = resolveFamilies();
  if (families) return { ok: true, families };
  return { ok: false, reason: MISSING_REASON };
}

module.exports = {
  BUNDLED_FONTS,
  BUNDLED_REGISTERED,
  FAMILY_CANDIDATES,
  FALLBACK_CANDIDATES,
  MISSING_REASON,
  resolveFamily,
  resolveFamilies,
  fontStacks,
  checkCanvasFonts,
};
