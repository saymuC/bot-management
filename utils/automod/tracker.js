/**
 * Histórico recente em memória, para as regras que dependem de "quantas vezes
 * nos últimos N segundos" (flood, repetição, spam entre canais, anexos) e para
 * a contagem de entradas do anti-raid.
 *
 * Fica em memória de propósito: são dados de segundos de vida, escritos a cada
 * mensagem do servidor. Gravar isso em SQLite seria uma escrita em disco por
 * mensagem para nada — reiniciar o bot perder a janela é irrelevante.
 *
 * Como todo Map de longa duração no projeto (rascunhos do /bot-status, cooldown
 * do mentionHandler), há varredura de limpeza: sem ela, cada usuário que já
 * falou uma vez ficaria na memória para sempre.
 */

/** Nada é guardado além disto, seja qual for a janela configurada. */
const MAX_RETENTION_MS = 10 * 60 * 1000;

/** Teto de eventos por usuário. Num flood extremo, a janela mais longa ainda cabe. */
const MAX_EVENTS_PER_USER = 60;

/** Intervalo da varredura que joga fora chaves sem evento recente. */
const SWEEP_INTERVAL_MS = 60 * 1000;

/** `guildId:userId` -> eventos de mensagem, do mais antigo para o mais novo. */
const messageEvents = new Map();

/** `guildId` -> timestamps de entrada de membros. */
const joinEvents = new Map();

const messageKey = (guildId, userId) => `${guildId}:${userId}`;

/** Descarta o que saiu da janela e devolve o que sobrou. */
function withinWindow(events, windowMs, now) {
  const cutoff = now - windowMs;
  return events.filter((event) => event.at > cutoff);
}

/**
 * Registra uma mensagem no histórico do autor.
 *
 * @param {string} guildId
 * @param {string} userId
 * @param {{ channelId: string, signature: string, attachments?: number, at?: number }} event
 *   `signature` é o texto já normalizado (é o que identifica mensagem repetida).
 */
function trackMessage(guildId, userId, { channelId, signature, attachments = 0, at = Date.now() }) {
  const key = messageKey(guildId, userId);
  const previous = withinWindow(messageEvents.get(key) ?? [], MAX_RETENTION_MS, at);

  previous.push({ at, channelId, signature, attachments });
  // Corta pelo começo: o evento mais novo é sempre o mais importante de manter.
  messageEvents.set(key, previous.slice(-MAX_EVENTS_PER_USER));
}

/**
 * Mensagens do usuário dentro da janela.
 * @returns {Array<{ at: number, channelId: string, signature: string, attachments: number }>}
 */
function messageHistory(guildId, userId, windowMs, now = Date.now()) {
  const events = messageEvents.get(messageKey(guildId, userId));
  if (!events?.length) return [];
  return withinWindow(events, Math.min(windowMs, MAX_RETENTION_MS), now);
}

/** Esquece o histórico de um usuário — usado após punir, para não punir duas vezes pelo mesmo flood. */
function forgetUser(guildId, userId) {
  messageEvents.delete(messageKey(guildId, userId));
}

function trackJoin(guildId, at = Date.now()) {
  const previous = withinWindow(joinEvents.get(guildId) ?? [], MAX_RETENTION_MS, at);
  previous.push({ at });
  joinEvents.set(guildId, previous.slice(-500));
}

/** Quantas entradas o servidor teve dentro da janela. */
function joinCount(guildId, windowMs, now = Date.now()) {
  const events = joinEvents.get(guildId);
  if (!events?.length) return 0;
  return withinWindow(events, Math.min(windowMs, MAX_RETENTION_MS), now).length;
}

/** Remove chaves cujo último evento já saiu da retenção. */
function sweep(now = Date.now()) {
  let removed = 0;

  for (const [key, events] of messageEvents) {
    const kept = withinWindow(events, MAX_RETENTION_MS, now);
    if (kept.length) messageEvents.set(key, kept);
    else {
      messageEvents.delete(key);
      removed += 1;
    }
  }
  for (const [guildId, events] of joinEvents) {
    const kept = withinWindow(events, MAX_RETENTION_MS, now);
    if (kept.length) joinEvents.set(guildId, kept);
    else joinEvents.delete(guildId);
  }

  return removed;
}

// unref() para a varredura não segurar o processo vivo — importa nos testes,
// que carregam este módulo e terminam sem desligar nada.
const sweepTimer = setInterval(() => sweep(), SWEEP_INTERVAL_MS);
sweepTimer.unref();

/** Só para os testes: começa de um estado limpo. */
function resetTracker() {
  messageEvents.clear();
  joinEvents.clear();
}

module.exports = {
  MAX_RETENTION_MS,
  MAX_EVENTS_PER_USER,
  SWEEP_INTERVAL_MS,
  trackMessage,
  messageHistory,
  forgetUser,
  trackJoin,
  joinCount,
  sweep,
  resetTracker,
};
