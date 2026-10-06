// @ts-check
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { baseEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { pageCount, clampPage, pageBounds } = require('../utils/levels/leaderboard');
const { leaderboardPage, participantCount, rankOf } = require('../utils/economy/repository');
const { formatMoney } = require('../utils/economy/formatter');
const { currency } = require('../utils/economy/currency');
const { renderEconomyRanking } = require('../utils/economy/card');

const PREFIX = 'ecotop_';

/** @param {import('discord.js').Guild} guild @param {unknown} requestedPage @param {string} userId */
async function buildRanking(guild, requestedPage, userId) {
  const total = participantCount(guild.id);
  const page = clampPage(requestedPage, total);
  const pages = pageCount(total);
  const { limit, offset } = pageBounds(page);
  const rows = leaderboardPage(guild.id, limit, offset);
  const medals = [emoji(guild, 'medal_gold'), emoji(guild, 'medal_silver'), emoji(guild, 'medal_bronze')];
  const { icon, name } = currency(guild);
  const lines = rows.map((row, index) => {
    const position = offset + index + 1;
    return `${medals[position - 1] ?? `#${position}`} <@${row.user_id}> · ${icon} ${formatMoney(row.wallet)}`;
  });
  const position = rankOf(guild.id, userId);
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}${page - 1}`).setEmoji(emoji(guild, 'page_prev'))
      .setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`${PREFIX}${page + 1}`).setEmoji(emoji(guild, 'page_next'))
      .setStyle(ButtonStyle.Secondary).setDisabled(page >= pages)
  ).toJSON()];
  const resolved = new Map();
  await Promise.all(rows.map(async (row) => {
    const member = guild.members.cache.get(row.user_id) ?? await guild.members.fetch(row.user_id).catch(() => null);
    const user = member?.user ?? guild.client.users.cache.get(row.user_id)
      ?? await guild.client.users.fetch(row.user_id).catch(() => null);
    resolved.set(row.user_id, {
      name: member?.displayName ?? user?.username ?? `Usuário ${row.user_id}`,
      avatarUrl: user?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
    });
  }));
  const image = await renderEconomyRanking({
    page, pages, currencyName: name,
    entries: rows.map((row, index) => ({
      position: offset + index + 1,
      name: resolved.get(row.user_id)?.name ?? row.user_id,
      avatarUrl: resolved.get(row.user_id)?.avatarUrl ?? null,
      balance: row.wallet,
    })),
  });
  if (image) return {
    content: `Sua posição: ${position ? `#${position}` : 'sem posição'}`, embeds: [], attachments: [],
    files: [new AttachmentBuilder(image, { name: `economia-p${page}.png` })], components,
  };
  return {
    embeds: [baseEmbed({
      title: `${emoji(guild, 'leaderboard')} Mais ricos de ${guild.name}`,
      description: lines.join('\n') || 'Ninguém ganhou moedas ainda.',
      footer: `Página ${page}/${pages} · ${formatMoney(total)} participante(s) · Sua posição: ${position ? `#${position}` : 'sem posição'}`,
    })],
    components, attachments: [], files: [],
  };
}

/** @param {import('discord.js').ButtonInteraction} interaction @param {string} raw */
async function handleRankingPagination(interaction, raw) {
  await interaction.deferUpdate();
  if (!interaction.guild) throw new Error('Ranking disponível apenas em servidores.');
  return interaction.editReply(await buildRanking(interaction.guild, raw, interaction.user.id));
}

module.exports = { PREFIX, buildRanking, handleRankingPagination };
