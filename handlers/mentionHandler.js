/**
 * Interações aleatórias quando o bot é mencionado.
 *
 * Regras: só menção explícita (`<@id>` escrito na mensagem), nunca @everyone,
 * nunca outro bot, e com cooldown por usuário para não virar spam.
 */

const { baseEmbed } = require('../utils/embeds');
const { RANDOM_TEXTS, RANDOM_EMBEDS, REACTIONS, KEYWORD_RULES } = require('../config/mentionReplies');

/**
 * Janela mínima entre duas respostas ao mesmo usuário.
 * Curta de propósito: só serve pra barrar menção repetida em rajada.
 */
const COOLDOWN_MS = 1500;
/** Chance de a resposta aleatória sair como embed em vez de texto. */
const EMBED_CHANCE = 0.25;
/** Chance de o bot também reagir à mensagem. */
const REACTION_CHANCE = 0.3;

const lastReplyAt = new Map();

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Substitui os placeholders aceitos nos textos configuráveis. */
function format(text, message) {
  return String(text ?? '')
    .replaceAll('{user}', `<@${message.author.id}>`)
    .replaceAll('{username}', message.member?.displayName ?? message.author.username)
    .replaceAll('{server}', message.guild?.name ?? 'servidor');
}

/** True apenas quando o autor escreveu a menção do bot no corpo da mensagem. */
function mentionsBotDirectly(message, clientUser) {
  if (message.mentions.everyone) return false;
  return message.content.includes(`<@${clientUser.id}>`);
}

function onCooldown(userId, now) {
  const previous = lastReplyAt.get(userId);
  return previous !== undefined && now - previous < COOLDOWN_MS;
}

/** Remove entradas vencidas para o Map não crescer indefinidamente. */
function pruneCooldowns(now) {
  for (const [userId, at] of lastReplyAt) {
    if (now - at >= COOLDOWN_MS) lastReplyAt.delete(userId);
  }
}

/** Escolhe a resposta: primeiro as regras por palavra-chave, senão sorteia. */
function resolveReply(message, client) {
  const rule = KEYWORD_RULES.find((entry) => entry.pattern.test(message.content));
  if (rule) return rule.build({ message, client });

  if (Math.random() < EMBED_CHANCE) return pickRandom(RANDOM_EMBEDS);
  return pickRandom(RANDOM_TEXTS);
}

/** Converte a resposta (string ou {title, description}) em payload de mensagem. */
function toPayload(reply, message) {
  if (typeof reply === 'string') {
    return { content: format(reply, message), allowedMentions: { repliedUser: true, parse: ['users'] } };
  }
  return {
    embeds: [
      baseEmbed({
        title: format(reply.title, message),
        description: format(reply.description, message),
        footer: message.member?.displayName ?? message.author.username,
      }),
    ],
    allowedMentions: { repliedUser: true, parse: ['users'] },
  };
}

/**
 * Ponto de entrada chamado pelo evento messageCreate.
 * Silencioso quando a mensagem não é uma menção válida.
 */
async function handleBotMention(message, client) {
  if (message.author.bot || !message.guild || !message.content) return;
  if (!mentionsBotDirectly(message, client.user)) return;

  const now = Date.now();
  if (onCooldown(message.author.id, now)) return;
  pruneCooldowns(now);
  lastReplyAt.set(message.author.id, now);

  try {
    await message.reply(toPayload(resolveReply(message, client), message));

    if (Math.random() < REACTION_CHANCE) {
      await message.react(pickRandom(REACTIONS)).catch(() => {});
    }
  } catch (err) {
    // Canal sem permissão de escrita / mensagem apagada: não é erro acionável.
    console.warn('[mention] Não consegui responder à menção:', err.message);
  }
}

module.exports = { COOLDOWN_MS, handleBotMention, format, resolveReply, toPayload };
