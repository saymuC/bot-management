// @ts-check
const { emoji, isBrokenCustomEmoji } = require('../emojis');
const { getEconomyConfig } = require('../../config/economy');

/** @param {import('discord.js').Guild} guild */
function currency(guild) {
  const config = getEconomyConfig(guild.id);
  const icon = config.currencyEmoji && !isBrokenCustomEmoji(guild, config.currencyEmoji)
    ? config.currencyEmoji : emoji(guild, 'eco_coin');
  return { icon, name: config.currencyName };
}
module.exports = { currency };
