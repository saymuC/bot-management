/**
 * Payload do `/top` e a paginação dele.
 *
 * Fica num handler, e não no comando, porque os botões de página precisam
 * remontar exatamente a mesma mensagem — se a montagem morasse no comando, a
 * paginação teria de duplicá-la.
 *
 * A resposta normal é uma **imagem**; o embed de texto continua aqui como reserva
 * para host sem fonte instalada ou qualquer falha no desenho.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { baseEmbed } = require('../utils/embeds');
const { calculateLevelFromXp } = require('../utils/levels/formula');
const { PAGE_SIZE, clampPage, pageCount, pageBounds, formatEntryLine, formatXp } = require('../utils/levels/leaderboard');
const { leaderboardPage, participantCount } = require('../utils/levels/repository');
const { getLevelsConfig } = require('../utils/levels/config');
const { renderLeaderboardCard } = require('../utils/levels/card/leaderboardCard');

/** Prefixo dos botões de página. Distinto de `lvl_`, que é o painel de admin. */
const PREFIX = 'lvltop_';

/**
 * Nome de exibição e avatar de cada id.
 *
 * Um `fetch` em lote resolve quem não está em cache de uma vez; quem continuar
 * ausente saiu do servidor e recebe um rótulo em vez de sumir da lista — a
 * posição existe no ranking e esconder a linha deixaria um furo na numeração.
 *
 * O avatar vem em 128 px porque é a maior medida que o card usa (o destaque tem
 * raio 44); pedir 256 seria dobrar o download para desenhar igual.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string[]} userIds
 * @returns {Promise<Map<string, { name: string, avatarUrl: string|null }>>}
 */
async function resolveEntries(guild, userIds) {
  const missing = userIds.filter((id) => !guild.members.cache.has(id));
  if (missing.length) await guild.members.fetch({ user: missing }).catch(() => null);

  const entries = new Map();
  for (const id of userIds) {
    const member = guild.members.cache.get(id);
    if (member) {
      entries.set(id, {
        name: member.displayName,
        avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
      });
      continue;
    }

    const user = guild.client.users.cache.get(id) ?? (await guild.client.users.fetch(id).catch(() => null));
    entries.set(id, {
      name: user ? `${user.username} (saiu)` : `Usuário ${id} (saiu)`,
      avatarUrl: user ? user.displayAvatarURL({ extension: 'png', size: 128 }) : null,
    });
  }
  return entries;
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
 * Reserva em texto, usada quando a imagem não pode ser gerada.
 *
 * É a montagem que o `/top` usava antes do card, preservada inteira: host sem
 * fonte continua tendo um ranking utilizável.
 *
 * @param {{ guildName: string, page: number, pages: number, total: number, entries: Array<{ position: number, name: string, totalXp: number }> }} data
 */
function buildTopEmbedPayload({ guildName, page, pages, total, entries }) {
  const lines = entries.map((entry) =>
    formatEntryLine({
      position: entry.position,
      name: entry.name,
      level: calculateLevelFromXp(entry.totalXp),
      totalXp: entry.totalXp,
    })
  );

  return {
    embeds: [
      baseEmbed({
        title: `🏆 Ranking de ${guildName}`,
        description: lines.length
          ? lines.join('\n')
          : 'Ninguém pontuou ainda. Assim que o sistema de níveis estiver ligado e alguém conversar, o ranking aparece aqui.',
        footer: `Página ${page}/${pages} · ${formatXp(total)} participante(s) · ${PAGE_SIZE} por página`,
      }),
    ],
    components: pageComponents(page, pages),
  };
}

/**
 * Imagem (ou embed de reserva) + botões de uma página do ranking.
 *
 * O nome do arquivo carrega a página porque o cliente do Discord guarda anexo por
 * nome: sem isso, trocar de página mostraria a imagem anterior em cache.
 * `attachments: []` acompanha o payload por causa do caminho de edição — sem ele,
 * o anexo antigo continuaria na mensagem ao lado do novo.
 *
 * @param {import('discord.js').Guild} guild
 * @param {unknown} requestedPage
 * @returns {Promise<object>}
 */
async function buildTopPayload(guild, requestedPage) {
  const total = participantCount(guild.id);
  const page = clampPage(requestedPage, total);
  const pages = pageCount(total);
  const { limit, offset } = pageBounds(page);

  const rows = leaderboardPage(guild.id, limit, offset);
  const resolved = await resolveEntries(
    guild,
    rows.map((row) => row.user_id)
  );

  const entries = rows.map((row, index) => {
    const info = resolved.get(row.user_id);
    return {
      position: offset + index + 1,
      id: row.user_id,
      name: info?.name ?? row.user_id,
      avatarUrl: info?.avatarUrl ?? null,
      totalXp: row.xp,
    };
  });

  const config = getLevelsConfig(guild.id);
  const image = await renderLeaderboardCard({
    guildId: guild.id,
    guildName: guild.name,
    page,
    pages,
    total,
    pageSize: PAGE_SIZE,
    entries,
    headline: config.headline,
    backgroundUrl: config.backgroundUrl,
  });

  if (!image) {
    return { ...buildTopEmbedPayload({ guildName: guild.name, page, pages, total, entries }), files: [], attachments: [] };
  }

  return {
    content: '',
    embeds: [],
    attachments: [],
    files: [new AttachmentBuilder(image, { name: `ranking-p${page}.png` })],
    components: pageComponents(page, pages),
  };
}

/**
 * Clique nos botões de página: edita a própria mensagem.
 *
 * `deferUpdate()` antes de montar porque o caminho da imagem pode gastar mais que
 * os 3 s do ack — dez downloads de avatar e o encode do PNG. Com cache quente
 * cabe, mas depender disso é depender de sorte, e o preço do erro é um
 * "interação falhou" na cara de quem clicou.
 *
 * Sem checagem de permissão de propósito — o ranking é público, e quem clicar em
 * "próxima" numa listagem que outra pessoa abriu só está vendo dado público.
 */
async function handleTopPagination(interaction, rawPage) {
  await interaction.deferUpdate();
  const payload = await buildTopPayload(interaction.guild, rawPage);
  return interaction.editReply(payload);
}

module.exports = { PREFIX, buildTopPayload, buildTopEmbedPayload, handleTopPagination, resolveEntries };
