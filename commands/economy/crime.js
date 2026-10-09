// @ts-check
const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { commitCrime, EconomyDisabledError } = require('../../utils/economy/service');
const { formatMoney, formatWait } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');
const { getLevelsConfig } = require('../../utils/levels/config');
const { getUserState } = require('../../utils/levels/service');
const { syncMemberRewards } = require('../../utils/levels/rewards');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('crime').setDescription('Arrisque a sorte por moedas e XP').setDMPermission(false),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    if (!interaction.guild) throw new Error('Comando disponível apenas em servidores.');
    let result;
    try {
      result = commitCrime({ guildId: interaction.guild.id, userId: interaction.user.id });
    } catch (err) {
      if (!(err instanceof EconomyDisabledError)) throw err;
      return respond(interaction, { embeds: [baseEmbed({ title: `${emoji(interaction.guild, 'eco_coin')} Economia`, description: err.message })] });
    }
    if (result.retryAt) return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(interaction.guild, 'timer')} Hora de esperar`,
      description: `A polícia está de olho. Tente novamente em **${formatWait(result.retryAt - Date.now())}**.`,
    })] });
    const { icon, name } = currency(interaction.guild);
    const guild = interaction.guild;
    if (result.xp && interaction.member && 'roles' in interaction.member) {
      const config = getLevelsConfig(guild.id);
      if (config.enabled) {
        const member = /** @type {import('discord.js').GuildMember} */ (interaction.member);
        try {
          const sync = await syncMemberRewards(member, config, getUserState(guild.id, interaction.user.id).level, 'XP do /crime');
          if (sync.problems.length) console.warn(`[crime] Recompensas em ${guild.id}: ${sync.problems.join(' · ')}`);
        } catch (err) {
          console.warn(`[crime] Falha ao sincronizar recompensas em ${guild.id}:`, err);
        }
      }
    }
    return respond(interaction, { embeds: [baseEmbed({
      title: `${emoji(guild, result.caught ? 'eco_police' : 'eco_crime')} ${result.caught ? 'Você foi pego!' : 'Você escapou!'}`,
      description: `Você tentou ${result.crime}. ${result.caught ? 'A polícia te pegou e aplicou uma multa.' : 'Conseguiu fugir antes da polícia chegar.'}`,
      fields: [
        { name: result.caught ? 'Multa' : 'Lucro', value: `${icon} **${result.amount > 0 ? '+' : ''}${formatMoney(result.amount)} ${name}**`, inline: true },
        { name: 'XP recebido', value: `**+${result.xp} XP**`, inline: true },
        { name: 'Saldo atual', value: `${icon} **${formatMoney(result.balance)} ${name}**`, inline: true },
      ],
    })] });
  },
};
