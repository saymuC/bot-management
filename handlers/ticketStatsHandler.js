const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { db } = require('../database/db');
const { baseEmbed, infoEmbed } = require('../utils/embeds');
const { formatDuration } = require('../utils/time');
const { emoji } = require('../utils/emojis');

const PAGE_SIZE = 10;

/**
 * Ranking de atendentes: nota média, tickets reivindicados, tickets fechados
 * e TMA (tempo médio de atendimento, do claim até o fechamento).
 *
 * A lista de atendentes é a união de quem reivindicou e de quem fechou tickets,
 * então alguém que só fechou tickets de outros ainda aparece no relatório.
 */
const statsQuery = db.prepare(`
  WITH agents AS (
    SELECT claimed_by AS agent_id FROM tickets WHERE guild_id = @guild AND claimed_by IS NOT NULL
    UNION
    SELECT closed_by  AS agent_id FROM tickets WHERE guild_id = @guild AND closed_by  IS NOT NULL
  )
  SELECT
    a.agent_id,
    (SELECT COUNT(*) FROM tickets t
       WHERE t.guild_id = @guild AND t.claimed_by = a.agent_id) AS claimed,
    (SELECT COUNT(*) FROM tickets t
       WHERE t.guild_id = @guild AND t.closed_by = a.agent_id) AS closed,
    (SELECT AVG(r.stars) FROM ticket_ratings r
       WHERE r.guild_id = @guild AND r.agent_id = a.agent_id) AS avg_stars,
    (SELECT COUNT(*) FROM ticket_ratings r
       WHERE r.guild_id = @guild AND r.agent_id = a.agent_id) AS ratings,
    (SELECT AVG(strftime('%s', t.closed_at) - strftime('%s', t.claimed_at)) FROM tickets t
       WHERE t.guild_id = @guild AND t.claimed_by = a.agent_id
         AND t.claimed_at IS NOT NULL AND t.closed_at IS NOT NULL) AS avg_handle_seconds
  FROM agents a
  ORDER BY (avg_stars IS NULL), avg_stars DESC, claimed DESC, closed DESC
`);

const summaryQuery = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM tickets WHERE guild_id = @guild) AS total,
    (SELECT COUNT(*) FROM tickets WHERE guild_id = @guild AND status = 'open') AS open,
    (SELECT AVG(stars) FROM ticket_ratings WHERE guild_id = @guild) AS avg_stars,
    (SELECT COUNT(*) FROM ticket_ratings WHERE guild_id = @guild) AS ratings,
    (SELECT AVG(strftime('%s', closed_at) - strftime('%s', claimed_at)) FROM tickets
       WHERE guild_id = @guild AND claimed_at IS NOT NULL AND closed_at IS NOT NULL) AS avg_handle_seconds
`);

/** "⭐ 4.75 (12)" ou "sem avaliações" — a estrela vem do /config-emojis. */
function formatRating(avgStars, ratings, star) {
  if (!ratings) return 'sem avaliações';
  return `${star} **${avgStars.toFixed(2)}**/5 (${ratings} ${ratings === 1 ? 'avaliação' : 'avaliações'})`;
}

function formatAgentLine(row, position, star) {
  const tma = row.avg_handle_seconds == null ? '—' : formatDuration(row.avg_handle_seconds * 1000);
  return [
    `**${position}.** <@${row.agent_id}> — ${formatRating(row.avg_stars, row.ratings, star)}`,
    `└ Reivindicados: **${row.claimed}** · Fechados: **${row.closed}** · TMA: **${tma}**`,
  ].join('\n');
}

function buildPaginationRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tstats_${page - 1}`)
      .setLabel('Anterior')
      .setEmoji('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('tstats_noop')
      .setLabel(`Página ${page + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`tstats_${page + 1}`)
      .setLabel('Próxima')
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1)
  );
}

/**
 * Monta uma página do relatório. Consulta o banco a cada chamada, então a
 * paginação é stateless — não guarda coleção nem expira com o tempo.
 */
function buildStatsPage(guildId, requestedPage = 0) {
  const rows = statsQuery.all({ guild: guildId });

  if (!rows.length) {
    return {
      embeds: [infoEmbed('Nenhum atendente registrado ainda. Os dados aparecem depois que os tickets forem reivindicados ou fechados.', '📊 Desempenho dos atendentes')],
      components: [],
    };
  }

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const page = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const star = emoji(guildId, 'ticket_rating');
  const summary = summaryQuery.get({ guild: guildId });
  const globalTma =
    summary.avg_handle_seconds == null ? '—' : formatDuration(summary.avg_handle_seconds * 1000);

  const embed = baseEmbed({
    title: '📊 Desempenho dos atendentes',
    description: slice
      .map((row, index) => formatAgentLine(row, page * PAGE_SIZE + index + 1, star))
      .join('\n\n'),
    fields: [
      { name: 'Atendentes', value: String(rows.length), inline: true },
      { name: 'Tickets', value: `${summary.total} (${summary.open} abertos)`, inline: true },
      { name: 'Nota média geral', value: formatRating(summary.avg_stars, summary.ratings, star), inline: true },
      { name: 'TMA geral', value: globalTma, inline: true },
    ],
    footer: `Ordenado por nota média · página ${page + 1} de ${totalPages}`,
  });

  return {
    embeds: [embed],
    components: totalPages > 1 ? [buildPaginationRow(page, totalPages)] : [],
  };
}

/** Clique em Anterior/Próxima → substitui a mensagem pela página pedida. */
async function handleStatsPagination(interaction, payload) {
  if (payload === 'noop') return interaction.deferUpdate();
  return interaction.update(buildStatsPage(interaction.guild.id, Number(payload)));
}

module.exports = { buildStatsPage, handleStatsPagination, PAGE_SIZE };
