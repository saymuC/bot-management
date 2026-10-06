// @ts-check
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { getBalance, rankOf } = require('../../utils/economy/repository');
const { formatMoney } = require('../../utils/economy/formatter');
const { currency } = require('../../utils/economy/currency');
const { renderBalanceCard } = require('../../utils/economy/card');

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
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const profile = await user.fetch().catch(() => user);
    const image = await renderBalanceCard({
      name: member?.displayName ?? user.username,
      balance, position, currencyName: name,
      avatarUrl: user.displayAvatarURL({ extension: 'png', size: 256 }),
      bannerUrl: profile.bannerURL?.({ extension: 'png', size: 1024 }) ?? null,
      status: member?.presence?.status ?? 'offline',
    });
    if (image) return respond(interaction, { files: [new AttachmentBuilder(image, { name: `saldo-${user.id}.png` })] });
    return respond(interaction, { embeds: [baseEmbed({
      title: `${icon} Carteira de ${user.username}`,
      description: `**${formatMoney(balance)} ${name}**\n${emoji(interaction.guild, 'leaderboard')} Posição: ${position ? `#${position}` : 'sem posição'}`,
    })] });
  },
};
