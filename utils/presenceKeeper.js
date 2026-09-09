/**
 * Garante que o status personalizado esteja sempre no ar.
 *
 * Por que isso é necessário — três motivos, todos reais:
 *
 * 1. **O gateway zera a presença em cada IDENTIFY.** Quando a conexão cai e o
 *    bot reidentifica (acontece sozinho, sem reiniciar o processo), o Discord
 *    volta ao padrão "online sem atividade". O evento `clientReady` é `once`,
 *    então nada reaplicava — o status simplesmente desaparecia.
 * 2. **`setPresence()` não confirma nada.** Ele só empilha um OP 3 no
 *    WebSocket; não existe resposta, erro nem promessa. Se o pacote sai antes
 *    da sessão estar de fato utilizável, o Discord descarta em silêncio — é
 *    exatamente o "às vezes o status não aparece" no boot.
 * 3. **Não há como ler a presença de volta.** `client.presence` devolve o
 *    estado local (o que nós mesmos setamos) e a presença real exigiria a
 *    intent `GuildPresences`. Sem verificação possível, a saída é reafirmar.
 *
 * A estratégia então é redundância barata: presença no IDENTIFY (feito no
 * `index.js`), reenvio no ready com duas repetições curtas, reenvio a cada
 * `shardReady`/`shardResume` e um reforço periódico.
 *
 * O limite do gateway é de 5 atualizações de presença a cada 20 s por shard —
 * os intervalos daqui ficam muito abaixo disso.
 */

const { Events } = require('discord.js');
const { getSavedPresence, applyPresence, describePresence } = require('./presence');

/** Reenvios logo depois do ready, cobrindo o pacote descartado no boot. */
const BOOT_RETRY_MS = Object.freeze([3_000, 15_000]);

/** Reforço periódico, para corrigir qualquer perda que passe pelas outras redes. */
const REASSERT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Presença que o bot *deveria* estar exibindo. É a fonte da verdade em memória:
 * o `/bot-status` atualiza aqui, e todo reenvio lê daqui.
 * @type {ReturnType<typeof getSavedPresence>|null}
 */
let desired = null;

let interval = null;
let started = false;

/** Reenvia a presença desejada, sem nunca derrubar quem chamou. */
function reassert(client, reason) {
  if (!desired) return;
  try {
    const applied = applyPresence(client, desired);
    if (!applied) return;
    if (reason !== 'reforco') console.log(`[presence] (${reason}) ${describePresence(applied)}`);
  } catch (err) {
    console.error(`[presence] Falha ao reaplicar (${reason}):`, err.message);
  }
}

/**
 * Troca a presença que o guardião mantém. Chamado pelo `/bot-status` para que
 * o valor novo — e não o antigo — seja o reafirmado nas próximas reconexões.
 */
function setDesiredPresence(client, presence) {
  const applied = applyPresence(client, presence);
  // Sem sessão nada foi enviado — manter o desejado antigo evita reafirmar um
  // valor que o usuário nem viu aplicado.
  if (applied) desired = applied;
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

  for (const delay of BOOT_RETRY_MS) {
    setTimeout(() => reassert(client, `retentativa ${delay / 1000}s`), delay).unref();
  }

  // Reconexão com nova sessão: a presença do IDENTIFY vale, mas reenviamos por
  // garantia. Resume: a sessão é a mesma, ainda assim é barato reafirmar.
  client.on(Events.ShardReady, () => reassert(client, 'shard reconectado'));
  client.on(Events.ShardResume, () => reassert(client, 'shard retomado'));

  interval = setInterval(() => reassert(client, 'reforco'), REASSERT_INTERVAL_MS);
  interval.unref();
}

module.exports = {
  BOOT_RETRY_MS,
  REASSERT_INTERVAL_MS,
  startPresenceKeeper,
  setDesiredPresence,
};
