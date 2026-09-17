const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/settings');
const { emoji } = require('./emojis');

/**
 * @param {{
 *   title?: string, description?: string, color?: number, footer?: string,
 *   thumbnail?: string, image?: string,
 *   fields?: { name: string, value: string, inline?: boolean }[],
 * }} [options]
 */
function baseEmbed({ title, description, color = colors.primary, footer, thumbnail, image, fields } = {}) {
  const embed = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (image) embed.setImage(image);
  if (fields?.length) embed.addFields(fields);
  return embed;
}

/**
 * Converte uma cor hex ("#5865F2" ou "5865F2") em inteiro.
 * @returns {number|null} null quando o formato é inválido.
 */
function parseHexColor(raw) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(raw ?? '').trim());
  return match ? parseInt(match[1], 16) : null;
}

/**
 * `guild` é opcional só por compatibilidade: sem ela o título usa o emoji padrão.
 * Passe-a nas mensagens que os membros veem — é o que faz o `/config-emojis`
 * valer também para o "✅ Sucesso" e o "❌ Erro".
 *
 * @param {string} description
 * @param {string} [title] título completo, já com o emoji que você quiser
 * @param {import('discord.js').Guild|string|null} [guild]
 */
const successEmbed = (description, title, guild = null) =>
  baseEmbed({ title: title ?? `${emoji(guild, 'success')} Sucesso`, description, color: colors.success });

/** @see successEmbed */
const errorEmbed = (description, title, guild = null) =>
  baseEmbed({ title: title ?? `${emoji(guild, 'error')} Erro`, description, color: colors.error });

const infoEmbed = (description, title) =>
  baseEmbed({ title, description, color: colors.info });

module.exports = { baseEmbed, successEmbed, errorEmbed, infoEmbed, parseHexColor };
