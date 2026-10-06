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
  data: new SlashCommandBuilder().setName('trabalhar').setDescription('Trabalha por moedas').setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    let result;
    try {
      result = claimReward({ guildId: interaction.guild.id, userId: interaction.user.id, action: 'work' });
    } catch (err) {
      if (!(err instanceof EconomyDisabledError)) throw err;
      return respond(interaction, { embeds: [baseEmbed({ title: `${emoji(interaction.guild, 'eco_coin')} Economia`, description: err.message })] });
    }
    const job = result.job;
    const { icon, name } = currency(interaction.guild);
    return respond(interaction, { embeds: [baseEmbed(result.retryAt ? {
      title: `${emoji(interaction.guild, 'timer')} Hora de descansar`,
      description: `Você ainda está cansado do último trabalho. Tente novamente em **${formatWait(result.retryAt - Date.now())}**.`,
    } : {
      title: `${emoji(interaction.guild, job.emojiKey)} Turno de ${job.name}`,
      description: job.messages[Math.floor(Math.random() * job.messages.length)],
      fields: [
        { name: 'Pagamento', value: `${icon} **+${formatMoney(result.reward)} ${name}**`, inline: true },
        { name: 'Saldo atual', value: `${icon} **${formatMoney(result.balance)} ${name}**`, inline: true },
      ],
    })] });
  },
};
