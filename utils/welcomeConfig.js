/**
 * Configuração das boas-vindas.
 *
 * Tudo fica num JSON em `guild_config.welcome_config`, porque a mensagem virou
 * um objeto composto (texto fora do embed + embed + mídia + ping). As colunas
 * antigas `welcome_channel_id`/`welcome_message` continuam sendo lidas na
 * primeira abertura do painel, para não perder configuração de quem já usava.
 */

const { getGuildConfig, setGuildConfig } = require('../database/db');
const { resolveColor } = require('./colors');
const { baseEmbed } = require('./embeds');
const { isHttpUrl } = require('./media');

/** Modos de envio da mensagem de boas-vindas. */
const MODES = Object.freeze({
  text: { label: 'Somente texto', emoji: '💬', description: 'Mensagem normal, sem embed' },
  embed: { label: 'Somente embed', emoji: '🖼️', description: 'Só o cartão colorido' },
  both: { label: 'Texto + embed', emoji: '✨', description: 'Texto por cima e embed abaixo' },
});

const THUMBNAIL_AVATAR = 'avatar';
const THUMBNAIL_NONE = 'none';

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  channelId: null,
  mode: 'embed',
  pingUser: true,
  content: 'Seja bem-vindo(a), {user}! 🎉',
  embed: Object.freeze({
    title: '👋 Novo membro!',
    description: 'Bem-vindo(a) {user} ao **{server}**!\nAgora somos **{membercount}** membros.',
    footer: '{server}',
    color: 'verde-discord',
    imageUrl: null,
    thumbnail: THUMBNAIL_AVATAR,
  }),
});

/** Placeholders documentados no painel e trocados em todos os campos de texto. */
const PLACEHOLDERS = Object.freeze({
  '{user}': 'menção do membro (@nome)',
  '{username}': 'nome de usuário',
  '{displayname}': 'apelido no servidor',
  '{tag}': 'usuário completo (nome#0000)',
  '{id}': 'ID do membro',
  '{server}': 'nome do servidor',
  '{membercount}': 'total de membros',
  '{date}': 'data de entrada',
});

/** Troca os placeholders pelos dados reais do membro. */
function formatPlaceholders(text, member) {
  if (!text) return '';
  return String(text)
    .replaceAll('\\n', '\n')
    .replaceAll('{user}', `${member}`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayname}', member.displayName)
    .replaceAll('{tag}', member.user.tag)
    .replaceAll('{id}', member.id)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', String(member.guild.memberCount))
    .replaceAll('{date}', new Date().toLocaleDateString('pt-BR'));
}

/** Mescla o JSON salvo com os defaults, garantindo formato válido. */
function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const embedSource = source.embed && typeof source.embed === 'object' ? source.embed : {};

  return {
    enabled: Boolean(source.enabled),
    channelId: source.channelId ?? null,
    mode: Object.hasOwn(MODES, source.mode) ? source.mode : DEFAULT_CONFIG.mode,
    pingUser: source.pingUser ?? DEFAULT_CONFIG.pingUser,
    content: typeof source.content === 'string' ? source.content : DEFAULT_CONFIG.content,
    embed: {
      title: embedSource.title ?? DEFAULT_CONFIG.embed.title,
      description: embedSource.description ?? DEFAULT_CONFIG.embed.description,
      footer: embedSource.footer ?? DEFAULT_CONFIG.embed.footer,
      color: embedSource.color ?? DEFAULT_CONFIG.embed.color,
      imageUrl: embedSource.imageUrl ?? null,
      thumbnail: embedSource.thumbnail ?? DEFAULT_CONFIG.embed.thumbnail,
    },
  };
}

/**
 * Lê a configuração do servidor, migrando o formato antigo quando necessário.
 * @returns {ReturnType<typeof normalizeConfig>}
 */
function getWelcomeConfig(guildId) {
  const row = getGuildConfig(guildId);

  if (row?.welcome_config) {
    try {
      return normalizeConfig(JSON.parse(row.welcome_config));
    } catch (err) {
      console.error('[welcome] JSON de configuração inválido, usando padrão:', err.message);
    }
  }

  // Formato antigo: canal + mensagem única em colunas separadas.
  if (row?.welcome_channel_id) {
    return normalizeConfig({
      ...DEFAULT_CONFIG,
      enabled: true,
      channelId: row.welcome_channel_id,
      embed: { ...DEFAULT_CONFIG.embed, description: row.welcome_message || DEFAULT_CONFIG.embed.description },
    });
  }

  return normalizeConfig(DEFAULT_CONFIG);
}

/**
 * Persiste a configuração (sem mutar a recebida).
 * Mantém `welcome_channel_id` sincronizado por compatibilidade.
 */
function saveWelcomeConfig(guildId, config) {
  const normalized = normalizeConfig(config);
  setGuildConfig(guildId, 'welcome_config', JSON.stringify(normalized));
  setGuildConfig(guildId, 'welcome_channel_id', normalized.enabled ? normalized.channelId : null);
  return normalized;
}

/** Thumbnail resolvida: avatar do membro, URL fixa ou nada. */
function resolveThumbnail(config, member) {
  const value = config.embed.thumbnail;
  if (value === THUMBNAIL_AVATAR) return member.user.displayAvatarURL({ size: 256 });
  if (!value || value === THUMBNAIL_NONE) return undefined;
  return isHttpUrl(value) ? value : undefined;
}

/**
 * Monta o payload real da mensagem de boas-vindas.
 *
 * `allowedMentions` limita a users/roles de propósito: a mensagem é escrita por
 * um admin, mas não vale arriscar um @everyone disparado a cada entrada.
 *
 * @returns {{ content?: string, embeds: import('discord.js').EmbedBuilder[], allowedMentions: object }}
 */
function buildWelcomeMessage(config, member) {
  const embeds = [];
  let content = config.mode === 'embed' ? '' : formatPlaceholders(config.content, member);

  // O ping precisa estar no corpo da mensagem: menção dentro de embed não notifica.
  if (config.pingUser && !content.includes(member.id)) {
    content = `${member} ${content}`.trim();
  }

  if (config.mode !== 'text') {
    embeds.push(
      baseEmbed({
        title: formatPlaceholders(config.embed.title, member) || undefined,
        description: formatPlaceholders(config.embed.description, member) || undefined,
        footer: formatPlaceholders(config.embed.footer, member) || undefined,
        color: resolveColor(config.embed.color) ?? undefined,
        thumbnail: resolveThumbnail(config, member),
        image: config.embed.imageUrl || undefined,
      })
    );
  }

  // O Discord rejeita mensagem sem conteúdo nem embed (ex.: modo texto com o
  // campo esvaziado); cai no texto padrão em vez de falhar silenciosamente.
  if (!content && !embeds.length) content = formatPlaceholders(DEFAULT_CONFIG.content, member);

  return {
    content: content || undefined,
    embeds,
    allowedMentions: { parse: ['users', 'roles'] },
  };
}

module.exports = {
  MODES,
  THUMBNAIL_AVATAR,
  THUMBNAIL_NONE,
  DEFAULT_CONFIG,
  PLACEHOLDERS,
  formatPlaceholders,
  normalizeConfig,
  getWelcomeConfig,
  saveWelcomeConfig,
  buildWelcomeMessage,
};
