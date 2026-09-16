/**
 * Guarda contra emoji fixo no código que o membro vê.
 *
 * Os arquivos abaixo já tiram todo emoji do `/config-emojis`. O teste falha se
 * alguém escrever de volta um dos emojis padrão do registro num deles — que é
 * exatamente como a configuração por servidor deixa de valer sem ninguém notar.
 *
 * Painéis de setup, cards em canvas (emoji personalizado não desenha) e o
 * transcript HTML ficam fora de propósito.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_EMOJIS } = require('../utils/emojis');

const ROOT = path.join(__dirname, '..');
const SKIP = /(?:^|[\\/])(?:test|node_modules|database)(?:[\\/])|Setup|ConfigHandler|config\.js|panel\.js|card|transcript\.js|emojis\.js/;

/** Comentário pode citar emoji à vontade; o que conta é o código. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

const WIRED = jsFiles(ROOT)
  .filter((file) => !SKIP.test(path.relative(ROOT, file)))
  .filter((file) => fs.readFileSync(file, 'utf8').includes('emoji('));

for (const file of WIRED) {
  const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
  test(`${rel} não tem emoji fixo do registro`, () => {
    const code = stripComments(fs.readFileSync(file, 'utf8'));

    const found = Object.entries(DEFAULT_EMOJIS)
      .filter(([, value]) => code.includes(value))
      .map(([key, value]) => `${value} (${key})`);

    assert.deepEqual(found, [], `use emoji(guild, chave) em vez de: ${found.join(', ')}`);
  });
}
