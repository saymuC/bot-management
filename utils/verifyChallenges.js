/**
 * Estado em memória dos captchas de verificação.
 *
 * Cada desafio vive poucos minutos entre o clique no painel e a resposta no
 * modal, então não vale persistir em banco — e guardar o código fora da memória
 * só aumentaria a superfície de vazamento. Os desafios e os cooldowns expiram
 * sozinhos para não vazar memória em servidores movimentados.
 *
 * Consequência aceita: reiniciar o bot descarta desafios e cooldowns em curso.
 * Quem estava no meio da verificação só precisa clicar no painel de novo.
 */

const { verify: verifyConfig } = require('../config/settings');

/** @type {Map<string, { code: string, image: Buffer, attempts: number, expiresAt: number, timer: NodeJS.Timeout }>} */
const challenges = new Map();

/** @type {Map<string, { until: number, timer: NodeJS.Timeout }>} */
const cooldowns = new Map();

/** Chave composta: o desafio é por pessoa e por servidor. */
const keyOf = (guildId, userId) => `${guildId}:${userId}`;

/** Agenda a limpeza automática de uma entrada, sem segurar o event loop. */
function scheduleCleanup(map, key, ttlMs) {
  const timer = setTimeout(() => map.delete(key), ttlMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * Cria (ou substitui) o desafio de uma pessoa preservando o contador de
 * tentativas: pedir uma imagem nova não pode zerar o limite, senão o limite
 * deixaria de existir.
 *
 * @returns {{ code: string, image: Buffer, attempts: number, expiresAt: number }}
 */
function putChallenge(guildId, userId, code, image) {
  const key = keyOf(guildId, userId);
  const previous = challenges.get(key);
  if (previous) clearTimeout(previous.timer);

  const entry = {
    code,
    image,
    attempts: previous?.attempts ?? 0,
    expiresAt: Date.now() + verifyConfig.challengeTtlMs,
    timer: scheduleCleanup(challenges, key, verifyConfig.challengeTtlMs),
  };
  challenges.set(key, entry);
  return entry;
}

/**
 * @returns {{ code: string, image: Buffer, attempts: number, expiresAt: number }|null}
 * null quando não existe ou já passou da validade.
 */
function getChallenge(guildId, userId) {
  const key = keyOf(guildId, userId);
  const entry = challenges.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    clearTimeout(entry.timer);
    challenges.delete(key);
    return null;
  }
  return entry;
}

function deleteChallenge(guildId, userId) {
  const key = keyOf(guildId, userId);
  const entry = challenges.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  challenges.delete(key);
}

/**
 * Registra um erro na resposta.
 *
 * Ao esgotar as tentativas o desafio é apagado e a pessoa entra em cooldown,
 * o que fecha a porta para força bruta no modal.
 *
 * @returns {{ remaining: number, blocked: boolean }}
 */
function registerFailure(guildId, userId) {
  const key = keyOf(guildId, userId);
  const entry = challenges.get(key);
  if (!entry) return { remaining: 0, blocked: true };

  const attempts = entry.attempts + 1;
  const remaining = Math.max(0, verifyConfig.maxAttempts - attempts);

  if (remaining === 0) {
    deleteChallenge(guildId, userId);
    startCooldown(guildId, userId);
    return { remaining: 0, blocked: true };
  }

  challenges.set(key, { ...entry, attempts });
  return { remaining, blocked: false };
}

function startCooldown(guildId, userId) {
  const key = keyOf(guildId, userId);
  const previous = cooldowns.get(key);
  if (previous) clearTimeout(previous.timer);

  cooldowns.set(key, {
    until: Date.now() + verifyConfig.cooldownMs,
    timer: scheduleCleanup(cooldowns, key, verifyConfig.cooldownMs),
  });
}

/** @returns {number} milissegundos restantes de cooldown; 0 quando liberado. */
function cooldownRemaining(guildId, userId) {
  const key = keyOf(guildId, userId);
  const entry = cooldowns.get(key);
  if (!entry) return 0;
  const remaining = entry.until - Date.now();
  if (remaining <= 0) {
    clearTimeout(entry.timer);
    cooldowns.delete(key);
    return 0;
  }
  return remaining;
}

module.exports = {
  putChallenge,
  getChallenge,
  deleteChallenge,
  registerFailure,
  cooldownRemaining,
};
