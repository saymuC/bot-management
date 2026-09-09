/**
 * Aparência do painel de verificação.
 *
 * Fica num JSON em `guild_config.verify_panel` porque virou um objeto composto
 * (embed + botão + a mensagem já publicada). Canal e cargo continuam nas colunas
 * `verify_channel_id`/`verify_role_id`: são lidos pelo fluxo de verificação em
 * si, não pela aparência.
 *
 * Só aceita imagens por URL. Anexo do Discord não serve aqui: a URL do CDN é
 * assinada e expira, então a configuração salva apontaria para um link morto —
 * diferente do /embed, que reenvia o arquivo na hora de mandar a mensagem.
 */

const { ButtonStyle } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/db');
const { emoji, isBrokenCustomEmoji } = require('./emojis');
const { isHttpUrl } = require('./media');

/** O Discord só tem quatro cores de botão — é tudo o que dá para oferecer. */
const BUTTON_STYLES = Object.freeze({
  verde: { label: 'Verde', emoji: '🟩', style: ButtonStyle.Success },
  azul: { label: 'Azul', emoji: '🟦', style: ButtonStyle.Primary },
  cinza: { label: 'Cinza', emoji: '⬜', style: ButtonStyle.Secondary },
  vermelho: { label: 'Vermelho', emoji: '🟥', style: ButtonStyle.Danger },
});

/**
 * Sentinela do emoji do botão: `null` significa "usa o do /config-emojis",
 * então é preciso um valor explícito para dizer "nenhum emoji".
 */
const NO_EMOJI = 'none';

const DEFAULT_CONFIG = Object.freeze({
  embed: Object.freeze({
    // null cai no padrão calculado com o emoji do servidor.
    title: null,
    description: 'Para liberar o acesso ao servidor, clique no botão abaixo e resolva o captcha.',
    footer: null,
    color: null,
    imageUrl: null,
    thumbnailUrl: null,
  }),
  button: Object.freeze({
    label: 'Verificar',
    emoji: null,
    style: 'verde',
  }),
  // Painel já publicado, para republicar editando em vez de empilhar mensagens.
  message: null,
});

/** Texto limpo e limitado ao máximo do campo; vazio cai no fallback. */
function normalizeText(value, max, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : fallback;
}

/** Só URL http(s) entra: o embed rejeita qualquer outra coisa. */
function normalizeUrl(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && isHttpUrl(clean) ? clean : null;
}

/** Mescla o JSON salvo com os padrões, descartando o que estiver inválido. */
function normalizePanelConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const embed = source.embed && typeof source.embed === 'object' ? source.embed : {};
  const button = source.button && typeof source.button === 'object' ? source.button : {};
  const message = source.message && typeof source.message === 'object' ? source.message : null;

  const isSnowflake = (value) => /^\d{17,21}$/.test(String(value ?? ''));

  return {
    embed: {
      title: normalizeText(embed.title, 256),
      // Sem descrição o embed sairia vazio, então o padrão volta a valer.
      description: normalizeText(embed.description, 4000, DEFAULT_CONFIG.embed.description),
      footer: normalizeText(embed.footer, 2048),
      color: normalizeText(embed.color, 32),
      imageUrl: normalizeUrl(embed.imageUrl),
      thumbnailUrl: normalizeUrl(embed.thumbnailUrl),
    },
    button: {
      label: normalizeText(button.label, 80, DEFAULT_CONFIG.button.label),
      emoji: button.emoji === NO_EMOJI ? NO_EMOJI : normalizeText(button.emoji, 64),
      style: Object.hasOwn(BUTTON_STYLES, button.style) ? button.style : DEFAULT_CONFIG.button.style,
    },
    message:
      message && isSnowflake(message.channelId) && isSnowflake(message.messageId)
        ? { channelId: String(message.channelId), messageId: String(message.messageId) }
        : null,
  };
}

/** @returns {ReturnType<typeof normalizePanelConfig>} */
function getVerifyPanelConfig(guildId) {
  const stored = getGuildConfig(guildId)?.verify_panel;
  if (!stored) return normalizePanelConfig(DEFAULT_CONFIG);
  try {
    return normalizePanelConfig(JSON.parse(stored));
  } catch (err) {
    console.error('[verify-setup] JSON de aparência inválido, usando padrão:', err.message);
    return normalizePanelConfig(DEFAULT_CONFIG);
  }
}

/** Persiste sem mutar o objeto recebido. @returns a config normalizada. */
function saveVerifyPanelConfig(guildId, config) {
  const normalized = normalizePanelConfig(config);
  setGuildConfig(guildId, 'verify_panel', JSON.stringify(normalized));
  return normalized;
}

/**
 * Emoji do botão pronto para `setEmoji()`.
 *
 * Sem valor próprio, usa a chave `verify` do /config-emojis — assim quem já
 * personalizou os emojis do bot não precisa repetir isso aqui. Um personalizado
 * que saiu do ar também cai no padrão: id inválido derruba o envio da mensagem.
 *
 * @returns {string|null} null quando o botão fica sem emoji.
 */
function resolveButtonEmoji(guild, config) {
  const value = config.button.emoji;
  if (value === NO_EMOJI) return null;
  if (!value || isBrokenCustomEmoji(guild, value)) return emoji(guild, 'verify');
  return value;
}

/** Título do embed, com o padrão dependente do emoji do servidor. */
function resolvePanelTitle(guild, config) {
  return config.embed.title ?? `${emoji(guild, 'verify')} Verificação`;
}

module.exports = {
  BUTTON_STYLES,
  NO_EMOJI,
  DEFAULT_CONFIG,
  normalizePanelConfig,
  getVerifyPanelConfig,
  saveVerifyPanelConfig,
  resolveButtonEmoji,
  resolvePanelTitle,
};
