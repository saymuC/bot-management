/**
 * Registro central dos emojis do bot.
 *
 * Todo emoji que aparece para os membros mora aqui, com um padrão unicode e uma
 * sobrescrita global do bot (JSON em `bot_settings.emoji_config`). Assim o
 * `/config-emojis` troca o visual do bot inteiro sem precisar mexer em código.
 *
 * Cuidado com emojis personalizados: o Discord só renderiza `<:nome:id>` se o
 * bot compartilhar um servidor com aquele emoji. Um id inválido faz o envio da
 * mensagem falhar inteiro — por isso `emoji()` volta ao padrão quando recebe a
 * guild e o emoji personalizado não existe mais nela.
 */

const { db, getBotSetting, setBotSetting } = require('../database/db');

const EMOJI_CONFIG_KEY = 'emoji_config';
const getLegacyEmojiConfig = db.prepare('SELECT emoji_config FROM guild_config WHERE emoji_config IS NOT NULL LIMIT 1');

/** Categorias, só para agrupar o painel. */
const CATEGORIES = Object.freeze({
  general: 'Gerais',
  tickets: 'Tickets',
  giveaway: 'Sorteios',
  members: 'Entrada e verificação',
  moderation: 'Moderação',
  levels: 'Níveis',
  roles: 'Cargos',
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
  timer: { label: 'Tempo', default: '⏳', category: 'general', usage: 'Esperas, prazos e itens vencidos' },
  page_prev: { label: 'Página anterior', default: '⬅️', category: 'general', usage: 'Botão de voltar em listas paginadas' },
  page_next: { label: 'Página seguinte', default: '➡️', category: 'general', usage: 'Botão de avançar em listas paginadas' },
  config_center: { label: 'Central de configuração', default: '⚙️', category: 'general', usage: 'Título do /config' },
  config_logs: { label: 'Configuração de logs', default: '📜', category: 'general', usage: 'Opção de logs no /config' },
  config_emojis: { label: 'Configuração de emojis', default: '😀', category: 'general', usage: 'Opção de emojis no /config' },

  ticket: { label: 'Ticket', default: '🎫', category: 'tickets', usage: 'Botão e título do painel de atendimento' },
  ticket_claim: { label: 'Assumir ticket', default: '🙋', category: 'tickets', usage: 'Botão de assumir o atendimento' },
  ticket_close: { label: 'Fechar ticket', default: '🔒', category: 'tickets', usage: 'Botão de fechar o ticket' },
  ticket_rating: { label: 'Avaliar ticket', default: '⭐', category: 'tickets', usage: 'Botão de avaliar o atendimento' },
  ticket_stats: { label: 'Relatório de tickets', default: '📊', category: 'tickets', usage: 'Título do /ticket-stats' },
  // Painel e ações administrativas de ticket
  ticket_notify: { label: 'Notificar atendente', default: '📣', category: 'tickets', usage: 'Botão de notificação para a equipe no canal do ticket' },
  ticket_admin: { label: 'Painel Admin', default: '🛠️', category: 'tickets', usage: 'Botão que abre o painel administrativo do ticket' },
  ticket_admin_notify_user: { label: 'Notificar autor', default: '📩', category: 'tickets', usage: 'Opção do Painel Admin para enviar DM ao autor' },
  ticket_admin_create_call: { label: 'Criar call', default: '🎧', category: 'tickets', usage: 'Opção do Painel Admin para criar canal de voz' },
  ticket_admin_add_members: { label: 'Adicionar membros', default: '➕', category: 'tickets', usage: 'Opção do Painel Admin para adicionar membros ao ticket' },
  ticket_admin_remove_members: { label: 'Remover membros', default: '➖', category: 'tickets', usage: 'Opção do Painel Admin para remover membros do ticket' },
  ticket_admin_transfer: { label: 'Transferir atendimento', default: '🔁', category: 'tickets', usage: 'Opção do Painel Admin para transferir o responsável' },
  ticket_admin_rename: { label: 'Renomear ticket', default: '✏️', category: 'tickets', usage: 'Opção do Painel Admin para renomear o canal' },

  giveaway: { label: 'Sorteio', default: '🎉', category: 'giveaway', usage: 'Botão de participar do sorteio' },
  giveaway_winner: { label: 'Vencedor', default: '🏆', category: 'giveaway', usage: 'Anúncio dos ganhadores' },
  giveaway_cancel: { label: 'Sorteio cancelado', default: '🚫', category: 'giveaway', usage: 'Log de sorteio cancelado' },
  giveaway_empty: { label: 'Sorteio sem participantes', default: '😢', category: 'giveaway', usage: 'Encerramento sem ninguém inscrito' },

  verify: { label: 'Verificação', default: '✅', category: 'members', usage: 'Botão de verificar-se' },
  verify_panel: { label: 'Desafio de verificação', default: '🔐', category: 'members', usage: 'Título do captcha e do log de verificação' },
  verify_code: { label: 'Inserir código', default: '⌨️', category: 'members', usage: 'Botão que abre o modal do captcha' },
  verify_retry: { label: 'Gerar outra imagem', default: '🔄', category: 'members', usage: 'Botão de trocar a imagem do captcha' },
  verify_blocked: { label: 'Verificação bloqueada', default: '⛔', category: 'members', usage: 'Tentativas esgotadas no captcha' },
  verify_done: { label: 'Verificado', default: '🎉', category: 'members', usage: 'Confirmação de quem passou no captcha' },
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
  pardon: { label: 'Perdão', default: '🕊️', category: 'moderation', usage: 'Perdão de infrações no /infractions' },
  dm_notice: { label: 'Aviso na DM', default: '📩', category: 'moderation', usage: 'Relato de DM enviada ao membro' },

  level_up: { label: 'Subiu de nível', default: '🎉', category: 'levels', usage: 'Anúncio de novo nível no canal' },
  rank: { label: 'Progresso', default: '📈', category: 'levels', usage: 'Título do /rank' },
  leaderboard: { label: 'Ranking', default: '🏆', category: 'levels', usage: 'Título do /top' },
  xp_add: { label: 'XP adicionado', default: '📈', category: 'levels', usage: 'Resposta e log do /add-xp' },
  xp_remove: { label: 'XP removido', default: '📉', category: 'levels', usage: 'Resposta e log do /remove-xp' },
  xp_set: { label: 'Nível definido', default: '📊', category: 'levels', usage: 'Resposta e log do /set-level' },
  medal_gold: { label: '1º lugar', default: '🥇', category: 'levels', usage: 'Primeiro colocado do ranking' },
  medal_silver: { label: '2º lugar', default: '🥈', category: 'levels', usage: 'Segundo colocado do ranking' },
  medal_bronze: { label: '3º lugar', default: '🥉', category: 'levels', usage: 'Terceiro colocado do ranking' },

  reaction_role: { label: 'Autoatribuição de cargo', default: '🎭', category: 'roles', usage: 'Painel e botão do /reactionrole-setup' },
  autorole: { label: 'Cargo automático', default: '🎖️', category: 'roles', usage: 'Opção e painel de autorole no /config' },

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

/** Emojis globais do bot (padrões + sobrescritas salvas). */
function getGuildEmojis() {
  const stored = getBotSetting(EMOJI_CONFIG_KEY) ?? getLegacyEmojiConfig.get()?.emoji_config;
  if (stored && !getBotSetting(EMOJI_CONFIG_KEY)) setBotSetting(EMOJI_CONFIG_KEY, stored);
  if (!stored) return { ...DEFAULT_EMOJIS };
  try {
    return normalizeEmojis(JSON.parse(stored));
  } catch (err) {
    console.error('[emojis] JSON inválido no banco, usando padrões:', err.message);
    return { ...DEFAULT_EMOJIS };
  }
}

/** Grava apenas o que difere do padrão, para o JSON não inflar. */
function saveGuildEmojis(_guildId, emojis) {
  const normalized = normalizeEmojis(emojis);
  const overrides = Object.fromEntries(
    KEYS.filter((key) => normalized[key] !== DEFAULT_EMOJIS[key]).map((key) => [key, normalized[key]])
  );

  setBotSetting(EMOJI_CONFIG_KEY, Object.keys(overrides).length ? JSON.stringify(overrides) : null);
  return normalized;
}

function setGuildEmoji(_guildId, key, value) {
  if (!Object.hasOwn(REGISTRY, key)) throw new Error(`Emoji desconhecido: ${key}`);
  return saveGuildEmojis(null, { ...getGuildEmojis(), [key]: value });
}

function resetGuildEmoji(_guildId, key) {
  if (!Object.hasOwn(REGISTRY, key)) throw new Error(`Emoji desconhecido: ${key}`);
  return saveGuildEmojis(null, { ...getGuildEmojis(), [key]: DEFAULT_EMOJIS[key] });
}

function resetGuildEmojis() {
  setBotSetting(EMOJI_CONFIG_KEY, null);
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
