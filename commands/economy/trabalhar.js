// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { claimReward } = require('../../utils/economy/service');
const { formatMoney, formatWait } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('trabalhar').setDescription('Trabalha por moedas').setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    const result = claimReward({ guildId: interaction.guild.id, userId: interaction.user.id, action: 'work' });
    const job = result.job;
    const { icon, name } = currency(interaction.guild);
    return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'eco_work')} Trabalho`,
      description: result.retryAt
        ? `${emoji(interaction.guild, 'timer')} Você ainda está cansado. Tente novamente em ${formatWait(result.retryAt - Date.now())}.`
        : `${emoji(interaction.guild, job.emojiKey)} Você trabalhou como **${job.name}**.\n\n${job.messages[Math.floor(Math.random() * job.messages.length)]}\n\n${icon} +${formatMoney(result.reward)} ${name} · Saldo: ${formatMoney(result.balance)}`,
    })] });
  },
};
