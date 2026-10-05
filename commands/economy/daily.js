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
  data: new SlashCommandBuilder().setName('daily').setDescription('Coleta sua recompensa diária').setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    const result = claimReward({ guildId: interaction.guild.id, userId: interaction.user.id, action: 'daily' });
    const { icon, name } = currency(interaction.guild);
    return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'eco_daily')} Recompensa diária`,
      description: result.retryAt
        ? `${emoji(interaction.guild, 'timer')} Você já coletou. Volte em ${formatWait(result.retryAt - Date.now())}.`
        : `Você coletou **${icon} +${formatMoney(result.reward)} ${name}**!\nSaldo: ${formatMoney(result.balance)} ${name}. Volte amanhã.`,
    })] });
  },
};
