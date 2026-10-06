// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { claimReward, EconomyDisabledError } = require('../../utils/economy/service');
const { formatMoney, formatWait } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('daily').setDescription('Coleta sua recompensa diária').setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    let result;
    try {
      result = claimReward({ guildId: interaction.guild.id, userId: interaction.user.id, action: 'daily' });
    } catch (err) {
      if (!(err instanceof EconomyDisabledError)) throw err;
      return respond(interaction, { embeds: [baseEmbed({ title: `${emoji(interaction.guild, 'eco_coin')} Economia`, description: err.message })] });
    }
    const { icon, name } = currency(interaction.guild);
    return respond(interaction, { embeds: [baseEmbed(result.retryAt ? {
      title: `${emoji(interaction.guild, 'timer')} Daily em espera`,
      description: `Você já coletou sua recompensa. Volte em **${formatWait(result.retryAt - Date.now())}**.`,
    } : {
      title: `${emoji(interaction.guild, 'eco_daily')} Recompensa diária`,
      description: `Seu presente de hoje já está na carteira. Volte amanhã para buscar o próximo!`,
      fields: [
        { name: 'Recebido', value: `${icon} **+${formatMoney(result.reward)} ${name}**`, inline: true },
        { name: 'Saldo atual', value: `${icon} **${formatMoney(result.balance)} ${name}**`, inline: true },
      ],
    })] });
  },
};
