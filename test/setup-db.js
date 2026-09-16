const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.DATABASE_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-test-db-'));
  process.env.DATABASE_PATH = path.join(dir, 'bot.sqlite');

  process.on('exit', () => {
    try {
      require('../database/db').db.close();
    } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
