// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { ITEMS } = require('../../utils/economy/shop');
const { purchaseItem } = require('../../utils/economy/service');
const { formatMoney } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('loja').setDescription('Veja a loja ou compre um item')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('item').setDescription('Item para comprar (omita para ver o catálogo)')
      .addChoices(...ITEMS.map((item) => ({ name: item.name, value: item.id })))),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    const { icon, name } = currency(interaction.guild);
    const itemId = interaction.options.getString('item');
    if (!itemId) return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'eco_shop')} Loja`,
      description: ITEMS.map((item) => `${emoji(interaction.guild, item.emojiKey)} **${item.name}** · ${icon} ${formatMoney(item.price)} ${name}`).join('\n')
        + '\n\nUse /loja item para comprar.',
    })] });
    try {
      const { item, balance } = purchaseItem({ guildId: interaction.guild.id, userId: interaction.user.id, itemId });
      return respond(interaction, { embeds: [baseEmbed({
        title: `${emoji(interaction.guild, 'eco_shop')} Compra concluída`,
        description: `${emoji(interaction.guild, item.emojiKey)} ${item.name} adicionado ao inventário.\nSaldo: ${icon} ${formatMoney(balance)} ${name}.`,
      })] });
    } catch (err) {
      if (!(err instanceof RangeError)) throw err;
      return respond(interaction, { embeds: [errorEmbed('Saldo insuficiente para essa compra.', undefined, interaction.guild)] });
    }
  },
};
