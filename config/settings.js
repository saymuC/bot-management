module.exports = {
  colors: {
    primary: 0x5865f2,
    success: 0x57f287,
    error: 0xed4245,
    warning: 0xfee75c,
    info: 0x5865f2,
  },
  emojis: {
    ticket: '🎫',
    giveaway: '🎉',
    verify: '✅',
    warn: '⚠️',
  },
  giveaway: {
    // intervalo (ms) da varredura de giveaways vencidos
    sweepIntervalMs: 30 * 1000,
  },
  ticket: {
    // máximo de tickets abertos simultâneos por usuário
    maxOpenPerUser: 3,
  },
};
