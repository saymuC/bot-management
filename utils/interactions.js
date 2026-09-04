/**
 * Responde a uma interação sem se preocupar com o estado dela.
 *
 * O roteador (events/interactionCreate.js) faz deferReply em toda slash command
 * para não estourar a janela de 3s do Discord (erro 10062 "Unknown interaction").
 * A ephemeralidade é decidida no defer, então os payloads aqui não levam flags.
 */
async function respond(interaction, payload) {
  if (interaction.deferred) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

module.exports = { respond };
