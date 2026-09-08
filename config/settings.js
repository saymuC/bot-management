module.exports = {
  colors: {
    primary: 0x5865f2,
    success: 0x57f287,
    error: 0xed4245,
    warning: 0xfee75c,
    info: 0x5865f2,
  },
  // Os emojis do bot ficam em utils/emojis.js: são configuráveis por servidor
  // pelo /config-emojis, então não podem ser constantes fixas aqui.
  giveaway: {
    // intervalo (ms) da varredura de giveaways vencidos
    sweepIntervalMs: 30 * 1000,
  },
  ticket: {
    // máximo de tickets abertos simultâneos por usuário
    maxOpenPerUser: 3,
  },
};
