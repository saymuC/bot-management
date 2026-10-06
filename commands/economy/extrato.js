// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { getBalance, getTransactions } = require('../../utils/economy/repository');
const { formatMoney } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');

const LABELS = Object.freeze({ daily: 'Recompensa diária', work: 'Trabalho', shop_purchase: 'Compra na loja' });

module.exports = {
  data: new SlashCommandBuilder().setName('extrato').setDescription('Mostra suas últimas movimentações de moedas')
    .setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    const { icon, name } = currency(interaction.guild);
    const rows = getTransactions(interaction.guild.id, interaction.user.id, 10);
    const lines = rows.map((row) => {
      const label = LABELS[row.type] ?? 'Ajuste de saldo';
      return `\`#${row.id}\` ${label} · **${row.amount > 0 ? '+' : ''}${formatMoney(row.amount)}** ${name} · saldo ${formatMoney(row.balance_after)}`;
    });
    return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'eco_statement')} Seu extrato`,
      description: lines.length ? lines.join('\n') : 'Nenhuma movimentação registrada ainda.',
      footer: `Saldo atual: ${icon} ${formatMoney(getBalance(interaction.guild.id, interaction.user.id))} ${name}`,
    })] });
  },
};
