// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { ITEMS } = require('../../utils/economy/shop');
const { purchaseItem, EconomyDisabledError } = require('../../utils/economy/service');
const { getEconomyConfig } = require('../../config/economy');
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
    if (!getEconomyConfig(interaction.guild.id).enabled) {
      return respond(interaction, { embeds: [baseEmbed({
        title: `${emoji(interaction.guild, 'eco_coin')} Economia`,
        description: 'A economia está desativada neste servidor.',
      })] });
    }
    const { icon, name } = currency(interaction.guild);
    const itemId = interaction.options.getString('item');
    if (!itemId) return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'eco_shop')} Vitrine da loja`,
      description: 'Escolha um item e use `/loja item` para levar para o inventário.',
      fields: ITEMS.map((item) => ({
        name: `${emoji(interaction.guild, item.emojiKey)} ${item.name}`,
        value: `${icon} **${formatMoney(item.price)} ${name}** · ${item.type === 'consumable' ? 'Consumível' : 'Colecionável'}`,
        inline: true,
      })),
    })] });
    try {
      const { item, balance } = purchaseItem({ guildId: interaction.guild.id, userId: interaction.user.id, itemId });
      return respond(interaction, { embeds: [baseEmbed({
        title: `${emoji(interaction.guild, 'eco_shop')} Compra concluída`,
        description: `${emoji(interaction.guild, item.emojiKey)} **${item.name}** foi para o seu inventário.`,
        fields: [
          { name: 'Preço pago', value: `${icon} ${formatMoney(item.price)} ${name}`, inline: true },
          { name: 'Saldo restante', value: `${icon} ${formatMoney(balance)} ${name}`, inline: true },
        ],
      })] });
    } catch (err) {
      if (err instanceof EconomyDisabledError) {
        return respond(interaction, { embeds: [baseEmbed({ title: `${emoji(interaction.guild, 'eco_coin')} Economia`, description: err.message })] });
      }
      if (!(err instanceof RangeError)) throw err;
      return respond(interaction, { embeds: [errorEmbed('Saldo insuficiente para essa compra.', undefined, interaction.guild)] });
    }
  },
};
