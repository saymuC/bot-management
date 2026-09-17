/**
 * Amarra o catálogo de utils/commandPermissions.js aos arquivos de comando.
 *
 * O catálogo é a fonte de verdade em tempo de execução, e os comandos repetem
 * grupo e permissão legada nos próprios metadados. Estes testes existem para os
 * dois lados não divergirem em silêncio — divergir aqui significa um comando que
 * o painel mostra num grupo e o gate decide por outro.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { COMMAND_GROUP, GROUPS, LEGACY_PERMISSION } = require('../utils/commandPermissions');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/** Todo módulo de comando, carregado de verdade (é o que o bot faz no boot). */
const modules = fs
  .readdirSync(COMMANDS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((dir) =>
    fs
      .readdirSync(path.join(COMMANDS_DIR, dir.name))
      .filter((file) => file.endsWith('.js'))
      .map((file) => {
        const full = path.join(COMMANDS_DIR, dir.name, file);
        return { rel: `commands/${dir.name}/${file}`, full, command: require(full) };
      })
  );

const byName = new Map(modules.map((entry) => [entry.command.data?.name, entry]));

test('todo comando do catálogo existe como arquivo', () => {
  const missing = Object.keys(COMMAND_GROUP).filter((name) => !byName.has(name));
  assert.deepEqual(missing, []);
});

test('metadados do comando batem com o catálogo', () => {
  for (const [name, group] of Object.entries(COMMAND_GROUP)) {
    const { command, rel } = byName.get(name);
    assert.equal(command.permissionGroup, group, `${rel}: permissionGroup`);
    assert.equal(command.requiredPermission, LEGACY_PERMISSION[name], `${rel}: requiredPermission`);
  }
});

test('comando controlado não usa setDefaultMemberPermissions', () => {
  // A permissão nativa registrada no Discord esconderia o comando de quem o
  // painel autorizou por cargo — o gate do bot nunca seria consultado.
  for (const name of Object.keys(COMMAND_GROUP)) {
    const { command, rel } = byName.get(name);
    assert.equal(command.data.toJSON().default_member_permissions ?? null, null, rel);
  }
});

test('comando controlado continua fora da DM', () => {
  for (const name of Object.keys(COMMAND_GROUP)) {
    const { command, rel } = byName.get(name);
    assert.equal(command.data.toJSON().dm_permission, false, rel);
  }
});

test('nenhum comando aparece em dois grupos', () => {
  const seen = new Set();
  for (const group of Object.keys(GROUPS)) {
    for (const name of Object.keys(GROUPS[group].commands)) {
      assert.equal(seen.has(name), false, `${name} está em mais de um grupo`);
      seen.add(name);
    }
  }
});

test('grupo cabe num select do Discord', () => {
  for (const [group, meta] of Object.entries(GROUPS)) {
    assert.ok(Object.keys(meta.commands).length <= 25, `${group} passa de 25 comandos`);
  }
});
