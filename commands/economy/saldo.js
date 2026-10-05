// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { getBalance, rankOf } = require('../../utils/economy/repository');
const { formatMoney } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('saldo').setDescription('Mostra a carteira de um membro')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro (padrão: você)')),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    const user = interaction.options.getUser('usuario') ?? interaction.user;
    if (user.bot) return respond(interaction, { embeds: [errorEmbed('Bots não possuem carteira.', undefined, interaction.guild)] });
    const balance = getBalance(interaction.guild.id, user.id);
    const position = rankOf(interaction.guild.id, user.id);
    const { icon, name } = currency(interaction.guild);
    return respond(interaction, { embeds: [baseEmbed({
      title: `${icon} Carteira de ${user.username}`,
      description: `**${formatMoney(balance)} ${name}**\n${emoji(interaction.guild, 'leaderboard')} Posição: ${position ? `#${position}` : 'sem posição'}`,
    })] });
  },
};
