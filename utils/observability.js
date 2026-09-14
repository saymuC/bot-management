/**
 * Observabilidade mínima: erro com contexto + retrato de saúde do processo.
 *
 * O problema que isto resolve é o de produção: `console.error(err.message)` diz
 * *o que* quebrou e nada sobre *onde* — sem servidor, sem usuário, sem comando,
 * não há como reproduzir. `logError` obriga o contexto a andar junto, numa linha
 * só (JSON) para ser grepável e parseável por qualquer coletor de log.
 *
 * O contador em memória existe porque a pergunta em produção quase nunca é "que
 * erro foi esse" — é "está piorando?". Só o total e os últimos, sem série
 * temporal: quem precisa de histórico manda o log para fora.
 */

const { version: discordVersion } = require('discord.js');

/** Quantos erros recentes o /health mostra. */
const RECENT_LIMIT = 10;

/** Campos que nunca vão para o log, mesmo se alguém passar por engano. */
const REDACTED = Object.freeze(['token', 'accessToken', 'refreshToken', 'secret', 'password', 'authorization']);

const stats = { total: 0, byScope: Object.create(null), recent: [] };

/** Remove chaves sensíveis e recorta valores gigantes antes de logar. */
function sanitizeContext(context) {
  const out = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (value === undefined || value === null) continue;
    if (REDACTED.some((needle) => key.toLowerCase().includes(needle.toLowerCase()))) continue;
    out[key] = typeof value === 'string' ? value.slice(0, 300) : value;
  }
  return out;
}

/**
 * Registra um erro com contexto e conta para o /health.
 *
 * @param {string} scope de onde veio (ex.: 'interactionCreate', 'ticket').
 * @param {unknown} err o erro; aceita string para chamadas sem Error em mãos.
 * @param {Record<string, unknown>} [context] guildId, userId, command, customId…
 * @returns {{ scope: string, message: string }} o resumo que foi registrado.
 */
function logError(scope, err, context = {}) {
  const error = err instanceof Error ? err : new Error(String(err));
  const entry = {
    at: new Date().toISOString(),
    scope,
    error: error.name,
    message: error.message,
    // `code` do discord.js/sqlite é o que separa "falha nossa" de "recusa da API".
    code: error.code ?? undefined,
    status: error.status ?? undefined,
    context: sanitizeContext(context),
  };

  stats.total += 1;
  stats.byScope[scope] = (stats.byScope[scope] ?? 0) + 1;
  stats.recent.unshift({ at: entry.at, scope, message: entry.message, code: entry.code });
  if (stats.recent.length > RECENT_LIMIT) stats.recent.pop();

  console.error(`[error] ${JSON.stringify(entry)}`);
  // A stack vai separada: numa linha só ela empurra o JSON para fora da tela do
  // terminal e do limite de linha de vários coletores.
  if (error.stack) console.error(error.stack);

  return { scope, message: entry.message };
}

/** Total, por escopo e os últimos erros. Cópia: o chamador não mexe no contador. */
const errorStats = () => ({
  total: stats.total,
  byScope: { ...stats.byScope },
  recent: stats.recent.map((item) => ({ ...item })),
});

/** Só para os testes: zera o contador entre casos. */
function resetErrorStats() {
  stats.total = 0;
  stats.byScope = Object.create(null);
  stats.recent = [];
}

/** "2d 4h 13m 8s", omitindo as unidades zeradas. */
function formatUptime(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const parts = [
    { value: Math.floor(total / 86400), suffix: 'd' },
    { value: Math.floor((total % 86400) / 3600), suffix: 'h' },
    { value: Math.floor((total % 3600) / 60), suffix: 'm' },
    { value: total % 60, suffix: 's' },
  ];
  return parts.filter((part) => part.value > 0).map((part) => `${part.value}${part.suffix}`).join(' ') || '0s';
}

const toMb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

/**
 * Retrato do processo agora: é o que responde "o bot está de pé e sadio?".
 *
 * `ready` é a única coisa que um healthcheck de orquestrador precisa olhar: o
 * processo pode estar vivo com o gateway caído, e nesse estado o bot não atende
 * ninguém — reiniciar é o certo. Por isso ele não olha só `process.uptime()`.
 *
 * `latencyMs` fica em -1 até o primeiro heartbeat (~41s após conectar); isso é
 * normal e não conta como não-saudável.
 *
 * @param {import('discord.js').Client|null} client
 */
function healthSnapshot(client) {
  const memory = process.memoryUsage();
  const ping = Number(client?.ws?.ping);

  return {
    ready: Boolean(client?.isReady?.()),
    uptime: {
      ms: Math.round(process.uptime() * 1000),
      human: formatUptime(process.uptime() * 1000),
      // O do client é menor que o do processo depois de uma reconexão.
      gatewayMs: client?.uptime ?? null,
    },
    memory: {
      rssMb: toMb(memory.rss),
      heapUsedMb: toMb(memory.heapUsed),
      heapTotalMb: toMb(memory.heapTotal),
    },
    discord: {
      user: client?.user?.tag ?? null,
      guilds: client?.guilds?.cache?.size ?? 0,
      channels: client?.channels?.cache?.size ?? 0,
      cachedMembers: client?.guilds?.cache?.reduce((sum, guild) => sum + guild.memberCount, 0) ?? 0,
      latencyMs: Number.isFinite(ping) ? Math.round(ping) : null,
    },
    errors: errorStats(),
    runtime: {
      node: process.version,
      discordJs: discordVersion,
      pid: process.pid,
    },
  };
}

module.exports = { logError, errorStats, resetErrorStats, healthSnapshot, formatUptime, RECENT_LIMIT };
