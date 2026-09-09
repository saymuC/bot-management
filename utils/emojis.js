/**
 * Registro central dos emojis do bot.
 *
 * Todo emoji que aparece para os membros mora aqui, com um padrão unicode e a
 * possibilidade de sobrescrita por servidor (JSON em `guild_config.emoji_config`).
 * Assim o `/config-emojis` troca o visual do bot sem precisar mexer em código.
 *
 * Cuidado com emojis personalizados: o Discord só renderiza `<:nome:id>` se o
 * bot compartilhar um servidor com aquele emoji. Um id inválido faz o envio da
 * mensagem falhar inteiro — por isso `emoji()` volta ao padrão quando recebe a
 * guild e o emoji personalizado não existe mais nela.
 */

const { getGuildConfig, setGuildConfig } = require('../database/db');

/** Categorias, só para agrupar o painel. */
const CATEGORIES = Object.freeze({
  general: 'Gerais',
  tickets: 'Tickets',
  giveaway: 'Sorteios',
  members: 'Entrada e verificação',
  moderation: 'Moderação',
  logs: 'Logs',
});

/**
 * Chaves configuráveis. A ordem aqui é a ordem do menu do painel.
 *
 * O painel lista **por categoria**, e não tudo de uma vez, justamente porque o
 * Discord aceita no máximo 25 opções num select: o limite passa a valer por
 * categoria, e não para o registro inteiro.
 */
const REGISTRY = Object.freeze({
  success: { label: 'Sucesso', default: '✅', category: 'general', usage: 'Confirmações de ações' },
  error: { label: 'Erro', default: '❌', category: 'general', usage: 'Mensagens de erro' },
  warning: { label: 'Aviso', default: '⚠️', category: 'general', usage: 'Alertas e avisos' },
  info: { label: 'Informação', default: 'ℹ️', category: 'general', usage: 'Mensagens informativas' },

  ticket: { label: 'Ticket', default: '🎫', category: 'tickets', usage: 'Botão e título do painel de atendimento' },
  ticket_claim: { label: 'Assumir ticket', default: '🙋', category: 'tickets', usage: 'Botão de assumir o atendimento' },
  ticket_close: { label: 'Fechar ticket', default: '🔒', category: 'tickets', usage: 'Botão de fechar o ticket' },
  ticket_rating: { label: 'Avaliar ticket', default: '⭐', category: 'tickets', usage: 'Botão de avaliar o atendimento' },

  giveaway: { label: 'Sorteio', default: '🎉', category: 'giveaway', usage: 'Botão de participar do sorteio' },
  giveaway_winner: { label: 'Vencedor', default: '🏆', category: 'giveaway', usage: 'Anúncio dos ganhadores' },
  giveaway_cancel: { label: 'Sorteio cancelado', default: '🚫', category: 'giveaway', usage: 'Log de sorteio cancelado' },

  verify: { label: 'Verificação', default: '✅', category: 'members', usage: 'Botão de verificar-se' },
  welcome: { label: 'Boas-vindas', default: '👋', category: 'members', usage: 'Mensagem de novo membro' },
  member_join: { label: 'Membro entrou', default: '📥', category: 'members', usage: 'Log de entrada' },
  member_leave: { label: 'Membro saiu', default: '📤', category: 'members', usage: 'Log de saída' },

  ban: { label: 'Ban', default: '🔨', category: 'moderation', usage: 'Log de banimento' },
  unban: { label: 'Unban', default: '🕊️', category: 'moderation', usage: 'Log de desbanimento' },
  kick: { label: 'Kick', default: '👢', category: 'moderation', usage: 'Log de expulsão' },
  mute: { label: 'Mute', default: '🔇', category: 'moderation', usage: 'Log de silenciamento' },
  warn: { label: 'Warn', default: '⚠️', category: 'moderation', usage: 'Log de advertência' },
  clear: { label: 'Limpeza', default: '🧹', category: 'moderation', usage: 'Log de mensagens apagadas' },
  automod: { label: 'AutoMod', default: '🛡️', category: 'moderation', usage: 'Painel, logs e /infractions do AutoMod' },
  automod_delete: { label: 'AutoMod apagou', default: '🚫', category: 'moderation', usage: 'Aviso de mensagem apagada pelo AutoMod' },
  raid: { label: 'Raid', default: '🚨', category: 'moderation', usage: 'Alerta de raid e entrada suspeita' },

  message_edit: { label: 'Mensagem editada', default: '✏️', category: 'logs', usage: 'Log de edição' },
  message_delete: { label: 'Mensagem apagada', default: '🗑️', category: 'logs', usage: 'Log de exclusão' },
  member_add_oauth: { label: 'Adicionado via OAuth', default: '➕', category: 'logs', usage: 'Log do /adduser' },
});

const KEYS = Object.freeze(Object.keys(REGISTRY));

/** Chaves de uma categoria, na ordem do registro. */
const keysOfCategory = (category) => KEYS.filter((key) => REGISTRY[key].category === category);

/**
 * Categorias que realmente têm chaves, na ordem de `CATEGORIES`.
 *
 * Nenhuma categoria pode passar de 25 chaves — é o teto de opções de um select
 * do Discord, e o painel monta uma opção por chave. A checagem é na carga do
 * módulo para o erro aparecer ao subir o bot, não ao abrir o painel.
 */
const CATEGORY_KEYS = Object.freeze(
  Object.fromEntries(Object.keys(CATEGORIES).map((category) => [category, Object.freeze(keysOfCategory(category))]))
);

const overflowing = Object.entries(CATEGORY_KEYS).filter(([, keys]) => keys.length > 25);
if (overflowing.length) {
  throw new Error(
    `[emojis] categorias acima de 25 chaves: ${overflowing.map(([c, k]) => `${c} (${k.length})`).join(', ')}`
  );
}

const orphan = KEYS.filter((key) => !Object.hasOwn(CATEGORIES, REGISTRY[key].category));
if (orphan.length) throw new Error(`[emojis] chaves com categoria inexistente: ${orphan.join(', ')}`);

/** `<:nome:id>` ou `<a:nome:id>`. */
const CUSTOM_EMOJI_RE = /^<(a?):([\w~]{2,32}):(\d{17,21})>$/;
/** Mesma coisa, mas para achar o emoji no meio de uma frase. */
const CUSTOM_EMOJI_ANYWHERE_RE = /<(a?):([\w~]{2,32}):(\d{17,21})>/;
/** Um grafema que o Discord aceita como emoji. */
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]/u;

/** Padrões de todas as chaves — usado como base de qualquer leitura. */
const DEFAULT_EMOJIS = Object.freeze(
  Object.fromEntries(KEYS.map((key) => [key, REGISTRY[key].default]))
);

/** @returns {{animated: boolean, name: string, id: string}|null} */
function parseCustomEmoji(value) {
  const match = CUSTOM_EMOJI_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  return { animated: match[1] === 'a', name: match[2], id: match[3] };
}

/**
 * Valida o que o usuário digitou no painel.
 *
 * Aceita **um** emoji unicode ou um personalizado no formato do Discord.
 * Texto solto é recusado porque `setEmoji()` rejeita e derrubaria o comando
 * que tentasse montar o botão.
 *
 * @returns {{ok: true, value: string, custom: boolean} | {ok: false, error: string}}
 */
function parseEmojiInput(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: false, error: 'Nada foi digitado.' };

  if (parseCustomEmoji(value)) return { ok: true, value, custom: true };

  if (value.includes('<') || value.includes(':')) {
    return {
      ok: false,
      error:
        'Formato de emoji personalizado inválido. Copie o emoji com uma barra invertida antes ' +
        '(`\\:nome:`) e cole o resultado, algo como `<:nome:123456789012345678>`.',
    };
  }

  const graphemes = [...new Intl.Segmenter().segment(value)];
  if (graphemes.length !== 1) return { ok: false, error: 'Envie apenas **um** emoji, sem texto em volta.' };
  if (!UNICODE_EMOJI_RE.test(value)) return { ok: false, error: 'Isso não parece um emoji.' };

  return { ok: true, value, custom: false };
}

/**
 * Pega o primeiro emoji de um texto livre — é o que o usuário digita no chat,
 * então pode vir com pontuação, espaços ou uma frase em volta.
 *
 * @returns {string|null} o emoji cru (`🎫` ou `<:nome:id>`) ou null se não houver.
 */
function extractFirstEmoji(text) {
  const raw = String(text ?? '');

  const custom = CUSTOM_EMOJI_ANYWHERE_RE.exec(raw);

  let unicode = null;
  for (const { segment, index } of new Intl.Segmenter().segment(raw)) {
    if (UNICODE_EMOJI_RE.test(segment)) {
      unicode = { value: segment, index };
      break;
    }
  }

  if (custom && (!unicode || custom.index < unicode.index)) return custom[0];
  return unicode?.value ?? null;
}

/** Mescla o JSON salvo com os padrões, descartando chaves e valores inválidos. */
function normalizeEmojis(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const merged = { ...DEFAULT_EMOJIS };

  for (const key of KEYS) {
    const parsed = parseEmojiInput(source[key]);
    if (parsed.ok) merged[key] = parsed.value;
  }
  return merged;
}

/** Emojis do servidor (padrões + sobrescritas salvas). */
function getGuildEmojis(guildId) {
  const stored = getGuildConfig(guildId)?.emoji_config;
  if (!stored) return { ...DEFAULT_EMOJIS };
  try {
    return normalizeEmojis(JSON.parse(stored));
  } catch (err) {
    console.error('[emojis] JSON inválido no banco, usando padrões:', err.message);
    return { ...DEFAULT_EMOJIS };
  }
}

/** Grava apenas o que difere do padrão, para o JSON não inflar. */
function saveGuildEmojis(guildId, emojis) {
  const normalized = normalizeEmojis(emojis);
  const overrides = Object.fromEntries(
    KEYS.filter((key) => normalized[key] !== DEFAULT_EMOJIS[key]).map((key) => [key, normalized[key]])
  );

  setGuildConfig(guildId, 'emoji_config', Object.keys(overrides).length ? JSON.stringify(overrides) : null);
  return normalized;
}

function setGuildEmoji(guildId, key, value) {
  if (!Object.hasOwn(REGISTRY, key)) throw new Error(`Emoji desconhecido: ${key}`);
  return saveGuildEmojis(guildId, { ...getGuildEmojis(guildId), [key]: value });
}

function resetGuildEmoji(guildId, key) {
  if (!Object.hasOwn(REGISTRY, key)) throw new Error(`Emoji desconhecido: ${key}`);
  return saveGuildEmojis(guildId, { ...getGuildEmojis(guildId), [key]: DEFAULT_EMOJIS[key] });
}

function resetGuildEmojis(guildId) {
  setGuildConfig(guildId, 'emoji_config', null);
  return { ...DEFAULT_EMOJIS };
}

/**
 * True quando o emoji personalizado não está acessível para o bot.
 *
 * O bot consegue usar emojis de qualquer servidor em que esteja, então a
 * verificação é no cache global do client; o cache da guild é só o fallback
 * para quando não há client (testes, objetos parciais).
 */
function isBrokenCustomEmoji(guild, value) {
  const custom = parseCustomEmoji(value);
  if (!custom || !guild) return false;
  const cache = guild.client?.emojis?.cache ?? guild.emojis?.cache;
  return cache ? !cache.has(custom.id) : false;
}

/**
 * O emoji de uma chave, pronto para usar em `setEmoji()` ou interpolar em texto.
 *
 * @param {import('discord.js').Guild|string|null} guild guild (preferível) ou o id dela
 * @param {keyof typeof REGISTRY} key
 */
function emoji(guild, key) {
  const fallback = DEFAULT_EMOJIS[key];
  if (fallback === undefined) throw new Error(`Emoji desconhecido: ${key}`);

  const guildId = typeof guild === 'string' ? guild : guild?.id;
  if (!guildId) return fallback;

  const value = getGuildEmojis(guildId)[key];
  // Emoji personalizado apagado do servidor quebraria o envio da mensagem.
  if (typeof guild === 'object' && isBrokenCustomEmoji(guild, value)) return fallback;
  return value;
}

module.exports = {
  CATEGORIES,
  CATEGORY_KEYS,
  REGISTRY,
  KEYS,
  DEFAULT_EMOJIS,
  parseCustomEmoji,
  parseEmojiInput,
  extractFirstEmoji,
  normalizeEmojis,
  getGuildEmojis,
  saveGuildEmojis,
  setGuildEmoji,
  resetGuildEmoji,
  resetGuildEmojis,
  isBrokenCustomEmoji,
  emoji,
};
