/**
 * O `DATABASE_PATH` é a única coisa entre o banco e um deploy que apaga tudo em
 * host que sobrescreve a pasta do código. Se ele deixar de ser respeitado, o bot
 * continua subindo — só grava no lugar errado, e ninguém descobre até o deploy
 * seguinte.
 *
 * Roda em processo filho porque o `database/db.js` abre o arquivo no require, e o
 * require é cacheado: dentro da suíte o banco padrão já está aberto.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('DATABASE_PATH manda no arquivo, criando a pasta se não existir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdb-'));
  const target = path.join(dir, 'sub', 'bot.sqlite');
  const dbModule = path.join(__dirname, '..', 'database', 'db.js');

  try {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(dbModule)})`], {
      env: { ...process.env, DATABASE_PATH: target },
      stdio: 'pipe',
    });

    assert.ok(fs.existsSync(target), 'o banco devia ter sido criado no caminho pedido');
    assert.ok(fs.statSync(target).size > 0, 'o schema devia ter sido aplicado');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
