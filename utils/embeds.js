const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/settings');

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

const successEmbed = (description, title = '✅ Sucesso') =>
  baseEmbed({ title, description, color: colors.success });

const errorEmbed = (description, title = '❌ Erro') =>
  baseEmbed({ title, description, color: colors.error });

const infoEmbed = (description, title) =>
  baseEmbed({ title, description, color: colors.info });

module.exports = { baseEmbed, successEmbed, errorEmbed, infoEmbed, parseHexColor };
