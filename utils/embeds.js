const { EmbedBuilder } = require('discord.js');
const { colors } = require('../config/settings');

function baseEmbed({ title, description, color = colors.primary, footer, thumbnail, fields } = {}) {
  const embed = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (fields?.length) embed.addFields(fields);
  return embed;
}

const successEmbed = (description, title = '✅ Sucesso') =>
  baseEmbed({ title, description, color: colors.success });

const errorEmbed = (description, title = '❌ Erro') =>
  baseEmbed({ title, description, color: colors.error });

const infoEmbed = (description, title) =>
  baseEmbed({ title, description, color: colors.info });

module.exports = { baseEmbed, successEmbed, errorEmbed, infoEmbed };
