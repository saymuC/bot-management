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
  verify: {
    // caracteres do código do captcha
    codeLength: 6,
    // tentativas por desafio antes de cair no cooldown
    maxAttempts: 3,
    // validade do desafio: depois disso é preciso gerar outro
    challengeTtlMs: 3 * 60 * 1000,
    // espera após esgotar as tentativas
    cooldownMs: 5 * 60 * 1000,
    // dimensões do PNG do captcha
    imageWidth: 420,
    imageHeight: 140,
    // ruído da imagem
    noiseLines: 4,
    noiseDots: 180,
  },
};
