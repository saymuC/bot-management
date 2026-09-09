/**
 * Garante que o status personalizado esteja no ar — e para de mexer assim que
 * confirmar que está.
 *
 * Por que existe: o gateway zera a presença em cada IDENTIFY. Quando a conexão
 * cai e o bot reidentifica sozinho (sem reiniciar o processo), o Discord volta
 * ao padrão "online sem atividade". O `clientReady` é `once`, então nada
 * reaplicava e o status simplesmente desaparecia.
 *
 * Como funciona: **primeiro olha, depois age.** Lê a presença que o Discord
 * está exibindo; se já for a desejada, não envia nada. Só quando divergir é que
 * envia, espera e confere de novo — até `MAX_ATTEMPTS`. Não existe verificação
 * periódica: o gatilho é sempre um evento (ready, reconexão, `/bot-status`).
 *
 * Limitação honesta: ler a presença real depende da intent privilegiada
 * `GuildPresences`, pedida no `index.js`. Sem ela, `readLivePresence` devolve
 * `null` e o único caminho é enviar uma vez e confiar (a presença também vai no
 * IDENTIFY). Com ela, o bot confere antes e não mexe em nada quando já está certo.
 */

const { ActivityType, Events, GatewayIntentBits } = require('discord.js');
const { getSavedPresence, buildPresenceData, applyPresence, describePresence } = require('./presence');

/** Tempo para o Discord ecoar a mudança antes da conferência. */
const VERIFY_DELAY_MS = 4_000;

/** Quantas vezes insistir quando o status continua diferente do desejado. */
const MAX_ATTEMPTS = 3;

/**
 * Presença que o bot *deveria* estar exibindo. Fonte da verdade em memória:
 * o `/bot-status` atualiza aqui e toda conferência compara com isto.
 * @type {ReturnType<typeof getSavedPresence>|null}
 */
let desired = null;

/** Evita duas conferências correndo juntas e brigando pelo mesmo status. */
let running = false;
let started = false;
let warnedNoIntent = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/**
 * O que o Discord está exibindo agora.
 * @returns {import('discord.js').Presence|null} null quando não é observável
 *   (sem a intent `GuildPresences`, ou nenhuma guild em cache ainda).
 */
/**
 * A intent de presença foi pedida no IDENTIFY?
 *
 * Ligar `PRESENCE INTENT` no portal do Discord não basta — sem pedir a intent
 * aqui o gateway não manda presença nenhuma. Separar os dois casos importa: "não
 * pedi a intent" é configuração, "pedi mas ainda não tenho em cache" é só tempo.
 */
const hasPresenceIntent = (client) =>
  Boolean(client.options?.intents?.has?.(GatewayIntentBits.GuildPresences));

function readLivePresence(client) {
  for (const guild of client.guilds.cache.values()) {
    const presence = guild.members.me?.presence;
    if (presence) return presence;
  }
  return null;
}

/** O texto que identifica a atividade — no tipo Custom o `name` é fixo. */
function activityLabel(activity) {
  return activity.type === ActivityType.Custom ? activity.state ?? '' : activity.name ?? '';
}

/**
 * Compara o que está no ar com o alvo.
 *
 * A `url` fica fora da comparação de propósito: o Discord nem sempre devolve o
 * link da transmissão de volta, e isso faria a conferência falhar para sempre.
 */
function matchesTarget(live, target) {
  if (live.status !== target.status) return false;

  const got = live.activities ?? [];
  if (got.length !== target.activities.length) return false;

  return target.activities.every(
    (want, i) => got[i]?.type === want.type && activityLabel(got[i]) === activityLabel(want)
  );
}

/**
 * Confere e, só se necessário, corrige o status.
 *
 * @param {import('discord.js').Client} client
 * @param {string} reason de onde veio o gatilho, para o log
 * @param {{alreadySent?: boolean}} [options] `alreadySent` pula o primeiro
 *   envio quando quem chamou já aplicou (caso do `/bot-status`).
 */
async function ensurePresence(client, reason, { alreadySent = false } = {}) {
  if (!desired || !client.user || running) return;
  running = true;

  try {
    const target = buildPresenceData(desired);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const shouldSend = !(attempt === 1 && alreadySent);

      if (shouldSend) {
        const live = readLivePresence(client);
        if (live && matchesTarget(live, target)) {
          if (attempt > 1) console.log(`[presence] (${reason}) confirmado: ${describePresence(desired)}`);
          return;
        }

        if (!live) {
          // Nada para conferir agora: envia uma vez e encerra. O próximo evento
          // (reconexão ou `/bot-status`) tenta de novo, já com o cache quente.
          if (!warnedNoIntent) {
            console.log(
              hasPresenceIntent(client)
                ? '[presence] Presença ainda não está em cache; aplico sem conferir desta vez.'
                : '[presence] Sem a intent GuildPresences não consigo reler o status; aplico sem conferir. ' +
                    'Ligue PRESENCE INTENT no portal e tire PRESENCE_INTENT=false do .env para o bot conferir antes de mexer.'
            );
            warnedNoIntent = true;
          }
          try {
            applyPresence(client, desired);
            console.log(`[presence] (${reason}) ${describePresence(desired)}`);
          } catch (err) {
            console.error(`[presence] Falha ao aplicar (${reason}):`, err.message);
          }
          return;
        }

        try {
          applyPresence(client, desired);
          console.log(`[presence] (${reason}) corrigindo status — tentativa ${attempt}/${MAX_ATTEMPTS}.`);
        } catch (err) {
          console.error(`[presence] Falha ao aplicar (${reason}):`, err.message);
          return;
        }
      }

      await sleep(VERIFY_DELAY_MS);

      const live = readLivePresence(client);
      if (!live) return;
      if (matchesTarget(live, target)) {
        console.log(`[presence] (${reason}) confirmado: ${describePresence(desired)}`);
        return;
      }
    }

    console.warn(
      `[presence] (${reason}) status ainda diferente do desejado depois de ${MAX_ATTEMPTS} tentativas; desisto ` +
        'até o próximo evento.'
    );
  } finally {
    running = false;
  }
}

/**
 * Troca a presença mantida pelo guardião. Aplica na hora (o usuário do
 * `/bot-status` espera resposta imediata) e depois confere em segundo plano.
 */
function setDesiredPresence(client, presence) {
  const applied = applyPresence(client, presence);
  // Sem sessão nada foi enviado — manter o desejado antigo evita reafirmar um
  // valor que o usuário nem viu aplicado.
  if (!applied) return null;

  desired = applied;
  void ensurePresence(client, 'alteração manual', { alreadySent: true });
  return applied;
}

/**
 * Liga o guardião. Idempotente: chamar de novo não duplica listeners.
 * @param {import('discord.js').Client} client
 */
function startPresenceKeeper(client) {
  desired = getSavedPresence();
  void ensurePresence(client, 'boot');

  if (started) return;
  started = true;

  // Reconexão zera a presença do lado do Discord, então é aqui — e só aqui —
  // que vale reconferir. Nenhum timer periódico.
  client.on(Events.ShardReady, () => void ensurePresence(client, 'shard reconectado'));
  client.on(Events.ShardResume, () => void ensurePresence(client, 'shard retomado'));
}

module.exports = {
  VERIFY_DELAY_MS,
  MAX_ATTEMPTS,
  readLivePresence,
  hasPresenceIntent,
  matchesTarget,
  startPresenceKeeper,
  setDesiredPresence,
};
