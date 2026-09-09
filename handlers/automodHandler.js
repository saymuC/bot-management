/**
 * O motor do AutoMod: recebe uma mensagem e decide se ela viola alguma regra.
 *
 * Ordem barata → cara, saindo o mais cedo possível: a função roda em **toda**
 * mensagem do servidor, então o caminho comum (servidor sem AutoMod ligado) tem
 * que custar quase nada.
 */

const { createHash } = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const { getAutomodConfig, exemptionReason } = require('../utils/automod/config');
const { findViolation } = require('../utils/automod/detectors');
const { enforce } = require('../utils/automod/enforce');
const { trackMessage } = require('../utils/automod/tracker');
const { toPlain } = require('../utils/automod/textNormalize');

/** Assinatura usada para detectar mensagem repetida. */
const signatureOf = (message) => toPlain(message.content);

/**
 * Identidade da **versão** do texto, para a trava de mensagem já punida.
 *
 * Deliberadamente diferente de `signatureOf`: aquela normaliza caixa e acento (é o
 * que faz "OI" e "oi" contarem como repetição), e aqui isso esconderia edição de
 * verdade — "aaaa" virando "AAAA" passa a violar caps sem mudar a assinatura
 * normalizada. Hash em vez do texto inteiro para o Map não guardar até 4 mil
 * caracteres por entrada.
 */
const versionOf = (message) =>
  createHash('sha1').update(String(message.content ?? '')).digest('base64');

/** Anexos + figurinhas contam juntos para o spam de anexos. */
const attachmentCount = (message) => message.attachments.size + (message.stickers?.size ?? 0);

/**
 * Anexos como `{ name, contentType }`.
 *
 * O `contentType` vem do Discord e é o que distingue gif de imagem sem depender
 * do nome do arquivo — que o autor escolhe e pode não ter extensão nenhuma.
 */
const attachmentFiles = (message) =>
  [...message.attachments.values()].map((a) => ({ name: a.name ?? '', contentType: a.contentType ?? '' }));

/**
 * Mensagens já punidas, `id` -> `{ version, at }`. Uma punição por *versão* da
 * mensagem.
 *
 * Existe porque o Discord manda `messageUpdate` para a **mesma** mensagem sem
 * ninguém tê-la editado: ao resolver um anexo, ao gerar o preview de um link, ao
 * fixar. Sem esta trava, um pdf no canal errado rendia duas punições — a segunda
 * com "não conseguiu apagar", porque a primeira já havia apagado.
 *
 * A versão do texto entra na chave porque travar só pelo id abria a brecha inversa:
 * uma regra que não apaga (`deleteMessage: false`) deixa a mensagem no canal, e o
 * autor podia editá-la para algo pior — um link malicioso — sabendo que o AutoMod
 * ia ignorar aquele id pelos cinco minutos seguintes. Mesmo id + mesmo texto é
 * update automático do Discord; mesmo id + texto diferente é edição de verdade e
 * precisa ser examinada.
 */
const handled = new Map();

/** Depois disto a mensagem não vai mais reaparecer em update automático. */
const HANDLED_TTL_MS = 5 * 60 * 1000;

/** Teto do Map: infratoras são poucas, mas o processo do bot fica dias no ar. */
const HANDLED_MAX = 1000;

/**
 * Mantém o Map dentro do teto: primeiro descarta o que já venceu; se ainda estiver
 * cheio (mil infratoras em cinco minutos), corta as mais antigas.
 *
 * Só limpar as expiradas não bastava — com o Map cheio de entradas ainda válidas
 * nada era removido e ele passava de `HANDLED_MAX` sem limite real. Perder a
 * entrada mais antiga é a falha certa: no pior caso a mensagem é reexaminada.
 */
function prune(now) {
  if (handled.size < HANDLED_MAX) return;

  for (const [id, entry] of handled) if (now - entry.at >= HANDLED_TTL_MS) handled.delete(id);

  // A ordem de inserção do Map é cronológica porque `markHandled` sempre deleta
  // antes de gravar — reinserir joga a entrada para o fim.
  for (const id of handled.keys()) {
    if (handled.size < HANDLED_MAX) break;
    handled.delete(id);
  }
}

function markHandled(messageId, version = '', now = Date.now()) {
  prune(now);
  handled.delete(messageId);
  handled.set(messageId, { version, at: now });
}

function wasHandled(messageId, version = '', now = Date.now()) {
  const entry = handled.get(messageId);
  if (entry === undefined) return false;

  if (now - entry.at >= HANDLED_TTL_MS) {
    handled.delete(messageId);
    return false;
  }

  // Texto diferente = edição real. A entrada sai para que a nova versão possa ser
  // punida por conta própria.
  if (entry.version !== version) {
    handled.delete(messageId);
    return false;
  }

  return true;
}

/**
 * Mensagens que o AutoMod nunca examina.
 *
 * Bots e webhooks ficam de fora porque quem os adicionou já tem controle sobre
 * eles — e o próprio bot avisando "sua mensagem foi apagada" não pode acabar
 * punido pelo filtro de menções.
 */
function isIgnorable(message) {
  return !message.guild || message.author?.bot || Boolean(message.webhookId) || !message.member;
}

/**
 * Examina uma mensagem e aplica as consequências.
 *
 * @param {import('discord.js').Message} message
 * @param {{ track?: boolean }} options `track: false` na edição — editar não é
 *   mandar de novo, e contar a edição como mensagem nova faria o flood disparar
 *   em quem só corrigiu um typo três vezes.
 * @returns {Promise<boolean>} true se houve violação (a mensagem pode ter sido apagada)
 */
async function inspectMessage(message, { track = true } = {}) {
  if (isIgnorable(message)) return false;

  // Já punida com este mesmo texto: devolve `true` para quem chamou tratar como
  // violação (é o que foi) sem punir de novo. O `has` antes evita hashear o texto
  // de toda mensagem do servidor só para consultar uma trava que quase nunca tem
  // entrada.
  if (handled.has(message.id) && wasHandled(message.id, versionOf(message))) return true;

  const config = getAutomodConfig(message.guild.id);
  if (!config.enabled) return false;

  // Isenção global antes de qualquer varredura: é o caminho mais curto para
  // deixar o staff e o canal de divulgação em paz.
  if (exemptionReason(config, { exemptRoleIds: [], exemptChannelIds: [] }, message.member, message.channel.id)) {
    return false;
  }

  // O AutoMod vale em **todo** canal: só o que estiver na lista de isenções fica
  // de fora. A única desistência é quando o Discord afirma que o bot não vê o
  // canal — e mesmo aí, se a permissão não puder ser resolvida (`members.me`
  // ainda não em cache, thread sem o pai carregado), segue examinando em vez de
  // ignorar a mensagem em silêncio.
  const me = message.guild.members.me;
  const perms = me ? message.channel.permissionsFor(me) : null;
  if (perms && !perms.has(PermissionFlagsBits.ViewChannel)) return false;

  const signature = signatureOf(message);
  const now = Date.now();

  // Registrado antes de avaliar: a mensagem atual conta na janela, e é assim que
  // "5 mensagens em 5s" viola na quinta e não na sexta.
  if (track) {
    trackMessage(message.guild.id, message.author.id, {
      channelId: message.channel.id,
      signature,
      attachments: attachmentCount(message),
      at: now,
    });
  }

  const files = attachmentFiles(message);
  const ctx = {
    content: message.content ?? '',
    signature,
    message,
    member: message.member,
    guild: message.guild,
    channelId: message.channel.id,
    attachmentFiles: files,
    attachmentNames: files.map((file) => file.name),
    attachments: attachmentCount(message),
    stickers: message.stickers?.size ?? 0,
    now,
  };

  const violation = await findViolation(ctx, config).catch((err) => {
    console.error(`[automod] Falha ao avaliar mensagem em ${message.guild.id}:`, err.message);
    return null;
  });

  if (!violation) return false;

  // Marcado antes de agir: se `enforce` falhar no meio (apagou e não conseguiu
  // silenciar), o update automático que vem em seguida não pode tentar de novo e
  // somar pontos pelo mesmo fato.
  markHandled(message.id, versionOf(message), now);

  await enforce(message, violation, config).catch((err) => {
    console.error(`[automod] Falha ao aplicar ação em ${message.guild.id}:`, err.message);
  });

  return true;
}

/**
 * Testa um texto contra as regras sem punir ninguém — usado pelo `/automod-test`.
 *
 * Nada é registrado no tracker, então as regras de flood/repetição só apontam o
 * que o histórico real do autor já mostra.
 *
 * @returns {Promise<{ key: string, label: string, detail: string }|null>}
 */
async function dryRun({ guild, member, channelId, content }) {
  const config = getAutomodConfig(guild.id);

  const violation = await findViolation(
    {
      content,
      signature: toPlain(content),
      message: null,
      member,
      guild,
      channelId,
      // O comando recebe texto, não arquivos: as regras de mídia só podem
      // apontar o que estiver **escrito** (link de imagem, gif de tenor).
      attachmentFiles: [],
      attachmentNames: [],
      attachments: 0,
      stickers: 0,
      now: Date.now(),
    },
    config
  );

  return violation ? { key: violation.key, label: violation.label, detail: violation.detail } : null;
}

module.exports = {
  inspectMessage,
  dryRun,
  isIgnorable,
  signatureOf,
  versionOf,
  HANDLED_TTL_MS,
  HANDLED_MAX,
  markHandled,
  wasHandled,
  /** Só para o teste conferir que o teto do Map é respeitado. */
  handledSize: () => handled.size,
};
