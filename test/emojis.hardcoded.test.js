/**
 * Guarda contra emoji fixo no código que o membro vê.
 *
 * Os arquivos abaixo já tiram todo emoji do `/config-emojis`. O teste falha se
 * alguém escrever de volta um dos emojis padrão do registro num deles — que é
 * exatamente como a configuração por servidor deixa de valer sem ninguém notar.
 *
 * Só os arquivos listados. Painéis de setup, cards em canvas (emoji personalizado
 * não desenha) e o transcript HTML ficam fora de propósito.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_EMOJIS } = require('../utils/emojis');

const WIRED = [
  'handlers/verifyHandler.js',
  'handlers/levelsHandler.js',
  'handlers/levelsLeaderboardHandler.js',
  'handlers/giveawayHandler.js',
  'handlers/ticketStatsHandler.js',
  'utils/levels/adminAction.js',
  'utils/automod/enforce.js',
  'utils/automod/raid.js',
  'commands/moderation/infractions.js',
  'commands/moderation/warnings.js',
  'commands/levels/rank.js',
];

/** Comentário pode citar emoji à vontade; o que conta é o código. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

for (const file of WIRED) {
  test(`${file} não tem emoji fixo do registro`, () => {
    const code = stripComments(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

    const found = Object.entries(DEFAULT_EMOJIS)
      .filter(([, value]) => code.includes(value))
      .map(([key, value]) => `${value} (${key})`);

    assert.deepEqual(found, [], `use emoji(guild, chave) em vez de: ${found.join(', ')}`);
  });
}
