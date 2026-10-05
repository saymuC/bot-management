// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { ITEMS } = require('../../utils/economy/shop');
const { getInventory } = require('../../utils/economy/repository');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('inventario').setDescription('Mostra os itens de um membro')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro (padrão: você)')),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    const user = interaction.options.getUser('usuario') ?? interaction.user;
    if (user.bot) return respond(interaction, { embeds: [errorEmbed('Bots não possuem inventário.', undefined, interaction.guild)] });
    const lines = getInventory(interaction.guild.id, user.id).map((row) => {
      const item = ITEMS.find((entry) => entry.id === row.item_id);
      return item ? `${emoji(interaction.guild, item.emojiKey)} ${item.name} ×${row.quantity}` : `${row.item_id} ×${row.quantity}`;
    });
    return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'eco_inventory')} Inventário de ${user.username}`,
      description: lines.join('\n') || 'Inventário vazio. Confira /loja para comprar itens.',
    })] });
  },
};
