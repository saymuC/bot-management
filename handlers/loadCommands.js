const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');

/**
 * Carrega recursivamente todos os comandos de commands/ para client.commands.
 * Retorna a lista de JSONs (usada pelo deploy-commands.js).
 */
function loadCommands(client) {
  client.commands = new Collection();
  const jsonList = [];
  const commandsDir = path.join(__dirname, '..', 'commands');
  if (!fs.existsSync(commandsDir)) return jsonList;

  for (const folder of fs.readdirSync(commandsDir)) {
    const folderPath = path.join(commandsDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    for (const file of fs.readdirSync(folderPath).filter((f) => f.endsWith('.js'))) {
      const filePath = path.join(folderPath, file);
      const command = require(filePath);
      if (!command?.data || !command?.execute) {
        console.warn(`[loadCommands] Ignorado (sem data/execute): ${filePath}`);
        continue;
      }
      client.commands.set(command.data.name, command);
      jsonList.push(command.data.toJSON());
    }
  }
  console.log(`[loadCommands] ${client.commands.size} comandos carregados.`);
  return jsonList;
}

module.exports = { loadCommands };
