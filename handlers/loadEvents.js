const fs = require('node:fs');
const path = require('node:path');

/** Registra todos os eventos de events/ no client. */
function loadEvents(client) {
  const eventsDir = path.join(__dirname, '..', 'events');
  if (!fs.existsSync(eventsDir)) return;

  let count = 0;
  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(eventsDir, file));
    if (!event?.name || !event?.execute) {
      console.warn(`[loadEvents] Ignorado (sem name/execute): ${file}`);
      continue;
    }
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, client));
    } else {
      client.on(event.name, (...args) => event.execute(...args, client));
    }
    count += 1;
  }
  console.log(`[loadEvents] ${count} eventos registrados.`);
}

module.exports = { loadEvents };
