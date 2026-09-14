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
const { getSavedPresence, applyPresence, describePresence } = require('./presence');

/**
 * Presença que o bot deve exibir. Fonte da verdade em memória: o `/bot-status`
 * atualiza aqui e toda reconexão reaplica isto.
 * @type {ReturnType<typeof getSavedPresence>|null}
 */
let desired = null;
let started = false;

function reassert(client, reason) {
  if (!desired || !client.user) return;
  try {
    applyPresence(client, desired);
    console.log(`[presence] (${reason}) ${describePresence(desired)}`);
  } catch (err) {
    console.error(`[presence] Falha ao aplicar (${reason}):`, err.message);
  }
}

/** Troca a presença mantida pelo guardião e aplica na hora. */
function setDesiredPresence(client, presence) {
  const applied = applyPresence(client, presence);
  // Sem sessão nada foi enviado — manter o desejado antigo evita reafirmar um
  // valor que o usuário nem viu aplicado.
  if (!applied) return null;

  desired = applied;
  return applied;
}

/**
 * Liga o guardião. Idempotente: chamar de novo não duplica listeners.
 * @param {import('discord.js').Client} client
 */
function startPresenceKeeper(client) {
  desired = getSavedPresence();
  reassert(client, 'boot');

  if (started) return;
  started = true;

  client.on(Events.ShardReady, () => reassert(client, 'shard reconectado'));
  client.on(Events.ShardResume, () => reassert(client, 'shard retomado'));
}

module.exports = { startPresenceKeeper, setDesiredPresence };
