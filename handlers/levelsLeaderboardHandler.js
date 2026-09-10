/**
 * Payload do `/top` e a paginação dele.
 *
 * Fica num handler, e não no comando, porque os botões de página precisam
 * remontar exatamente a mesma mensagem — se a montagem morasse no comando, a
 * paginação teria de duplicá-la.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../utils/embeds');
const { calculateLevelFromXp } = require('../utils/levels/formula');
const { PAGE_SIZE, clampPage, pageCount, pageBounds, formatEntryLine, formatXp } = require('../utils/levels/leaderboard');
const { leaderboardPage, participantCount } = require('../utils/levels/repository');

/** Prefixo dos botões de página. Distinto de `lvl_`, que é o painel de admin. */
const PREFIX = 'lvltop_';

/**
 * Nome de exibição de cada id.
 *
 * Um `fetch` em lote resolve quem não está em cache de uma vez; quem continuar
 * ausente saiu do servidor e recebe um rótulo em vez de sumir da lista — a
 * posição existe no ranking e esconder a linha deixaria um furo na numeração.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string>>}
 */
async function resolveNames(guild, userIds) {
  const missing = userIds.filter((id) => !guild.members.cache.has(id));
  if (missing.length) await guild.members.fetch({ user: missing }).catch(() => null);

  const names = new Map();
  for (const id of userIds) {
    const member = guild.members.cache.get(id);
    if (member) {
      names.set(id, member.displayName);
      continue;
    }
    const user = guild.client.users.cache.get(id) ?? (await guild.client.users.fetch(id).catch(() => null));
    names.set(id, user ? `${user.username} (saiu)` : `Usuário ${id} (saiu)`);
  }
  return names;
}

/** Botões de navegação; desabilitados nas pontas em vez de escondidos. */
function pageComponents(page, pages) {
  if (pages <= 1) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${page - 1}`)
        .setLabel('Anterior')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}${page + 1}`)
        .setLabel('Próxima')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages)
    ),
  ];
}

/**
 * Embed + botões de uma página do ranking.
 *
 * @param {import('discord.js').Guild} guild
 * @param {unknown} requestedPage
 * @returns {Promise<{ embeds: object[], components: object[] }>}
 */
async function buildTopPayload(guild, requestedPage) {
  const total = participantCount(guild.id);
  const page = clampPage(requestedPage, total);
  const pages = pageCount(total);
  const { limit, offset } = pageBounds(page);

  const rows = leaderboardPage(guild.id, limit, offset);
  const names = await resolveNames(guild, rows.map((row) => row.user_id));

  const lines = rows.map((row, index) =>
    formatEntryLine({
      position: offset + index + 1,
      name: names.get(row.user_id) ?? row.user_id,
      level: calculateLevelFromXp(row.xp),
      totalXp: row.xp,
    })
  );

  const embed = baseEmbed({
    title: `🏆 Ranking de ${guild.name}`,
    description: lines.length
      ? lines.join('\n')
      : 'Ninguém pontuou ainda. Assim que o sistema de níveis estiver ligado e alguém conversar, o ranking aparece aqui.',
    footer: `Página ${page}/${pages} · ${formatXp(total)} participante(s) · ${PAGE_SIZE} por página`,
  });

  return { embeds: [embed], components: pageComponents(page, pages) };
}

/**
 * Clique nos botões de página: edita a própria mensagem.
 *
 * Sem checagem de permissão de propósito — o ranking é público, e quem clicar em
 * "próxima" numa listagem que outra pessoa abriu só está vendo dado público.
 */
async function handleTopPagination(interaction, rawPage) {
  const payload = await buildTopPayload(interaction.guild, rawPage);
  return interaction.update(payload);
}

module.exports = { PREFIX, buildTopPayload, handleTopPagination, resolveNames };
