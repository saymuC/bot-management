/**
 * Reaplica o status personalizado nos momentos em que o Discord o zera.
 *
 * Por que existe: o gateway zera a presença em cada IDENTIFY. Quando a conexão
 * cai e o bot reidentifica sozinho (sem reiniciar o processo), o Discord volta
 * ao padrão "online sem atividade". O `clientReady` é `once`, então nada
 * reaplicava e o status simplesmente desaparecia. O gatilho é sempre um evento
 * (boot, reconexão, `/bot-status`) — não existe timer periódico.
 *
 * Por que não confere antes de mexer: a presença do próprio bot não é
 * observável. `guild.members.me.presence` sai de `guild.presences.cache`, que
 * só muda com um `PRESENCE_UPDATE`, e o Discord não manda esse evento para a
 * presença do próprio bot — o cache fica congelado no valor que veio no
 * `GUILD_CREATE`. A versão anterior comparava com esse valor velho, concluía
 * que a mudança tinha falhado e reenviava até desistir, sempre com o status
 * certo no ar. Reaplicar às cegas é um OP 3 por evento: mais barato que a
 * conferência que nunca funcionou (e dispensa a intent privilegiada de
 * presença, que carregava o cache de presença de todos os membros).
 */

const { Events } = require('discord.js');
const {
  getSavedPresence,
  applyPresence,
  describePresence,
  resolvePresenceTemplates,
  normalizePresence,
} = require('./presence');

/**
 * Presença (bruta) que o bot deve exibir — pode conter placeholders.
 * Fonte da verdade em memória: o `/bot-status` atualiza aqui e toda reconexão
 * reaplica isto.
 * @type {ReturnType<typeof getSavedPresence>|null}
 */
let desiredRaw = null;
/** Última presença resolvida (placeholders substituídos) aplicada de fato. */
let lastApplied = null;
const startedClients = new WeakSet();

function reassert(client, reason) {
  if (!desiredRaw || !client.user) return;
  try {
    // Resolve placeholders dinamicamente antes de aplicar
    const resolved = resolvePresenceTemplates(client, desiredRaw);
    // Evita enviar OP 3 se nada mudou APENAS no refresh periódico; em
    // reconexões forçamos reaplicar para garantir a presença no Discord.
    if (reason === 'refresh timer' && JSON.stringify(resolved) === JSON.stringify(lastApplied)) return;
    applyPresence(client, resolved);
    lastApplied = resolved;
    console.log(`[presence] (${reason}) ${describePresence(resolved)}`);
  } catch (err) {
    console.error(`[presence] Falha ao aplicar (${reason}):`, err.message);
  }
}

/** Troca a presença mantida pelo guardião e aplica na hora. */
function setDesiredPresence(client, presence) {
  if (!client.user) return null;
  // Guardamos o valor bruto (com placeholders) para permitir resolução dinâmica.
  desiredRaw = normalizePresence(presence);
  // Aplica já resolvendo para feedback imediato
  const resolved = resolvePresenceTemplates(client, desiredRaw);
  applyPresence(client, resolved);
  lastApplied = resolved;
  return resolved;
}

/**
 * Liga o guardião. Idempotente: chamar de novo não duplica listeners.
 * @param {import('discord.js').Client} client
 */
function startPresenceKeeper(client) {
  desiredRaw = getSavedPresence();
  reassert(client, 'boot');

  if (startedClients.has(client)) return;
  startedClients.add(client);

  client.on(Events.ShardReady, () => reassert(client, 'shard reconectado'));
  client.on(Events.ShardResume, () => reassert(client, 'shard retomado'));

  // Refresh periódico para manter variáveis ({guilds}, {users}, {cluster}) atualizadas
  const msFromEnv = Number(process.env.PRESENCE_REFRESH_INTERVAL_MS);
  const minFromEnv = Number(process.env.PRESENCE_REFRESH_MINUTES);
  const intervalMs = Number.isFinite(msFromEnv)
    ? Math.max(60_000, msFromEnv)
    : Number.isFinite(minFromEnv)
    ? Math.max(1, minFromEnv) * 60_000
    : 5 * 60_000; // padrão: 5 minutos

  // unref: o timer não deve, sozinho, manter o processo vivo. Em produção quem
  // segura o event loop é o socket do gateway; sem isto qualquer processo que
  // só liga o guardião (teste, script) nunca termina.
  setInterval(() => reassert(client, 'refresh timer'), intervalMs).unref();
}

module.exports = { startPresenceKeeper, setDesiredPresence };
