const { MessageFlags } = require('discord.js');
const { db } = require('../database/db');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { colors, giveaway: giveawaySettings } = require('../config/settings');
const { emoji } = require('../utils/emojis');

const stmts = {
  byId: db.prepare('SELECT * FROM giveaways WHERE id = ?'),
  pending: db.prepare("SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= datetime('now')"),
  enter: db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)'),
  entries: db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?'),
  entryCount: db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?'),
  markEnded: db.prepare('UPDATE giveaways SET ended = 1 WHERE id = ?'),
  markCancelled: db.prepare('UPDATE giveaways SET ended = 1, cancelled = 1, cancelled_by = ? WHERE id = ?'),
  openByGuild: db.prepare(
    'SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 ORDER BY ends_at ASC LIMIT 25'
  ),
};

/**
 * Resolve a opção do comando (vinda do autocomplete ou digitada à mão) em um
 * sorteio do próprio servidor. Retorna null para entrada inválida ou de outra guild.
 */
function findGuildGiveaway(guildId, raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;

  const giveaway = stmts.byId.get(id);
  return giveaway && giveaway.guild_id === guildId ? giveaway : null;
}

/** Sorteios em andamento do servidor — usados no autocomplete de /giveaway-end e /giveaway-stop. */
function listOpenGiveaways(guildId) {
  return stmts.openByGuild.all(guildId);
}

/**
 * Autocomplete compartilhado: mostra "#id — prêmio (N participantes)".
 * O value é o ID em string, então o comando resolve o sorteio sem ambiguidade
 * mesmo que dois sorteios tenham o mesmo prêmio.
 */
async function autocompleteOpenGiveaways(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();

  const choices = listOpenGiveaways(interaction.guild.id)
    .map((giveaway) => ({
      name: `#${giveaway.id} — ${giveaway.prize} (${stmts.entryCount.get(giveaway.id).n} participantes)`.slice(0, 100),
      value: String(giveaway.id),
    }))
    .filter((choice) => choice.name.toLowerCase().includes(typed));

  return interaction.respond(choices.slice(0, 25));
}

/** Sorteia N vencedores únicos entre as entradas. */
function pickWinners(giveawayId, count) {
  const entries = stmts.entries.all(giveawayId).map((row) => row.user_id);
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

/** Botão "Participar" do painel do sorteio. */
async function handleEntryButton(interaction, giveawayId) {
  const giveaway = stmts.byId.get(Number(giveawayId));
  if (!giveaway || giveaway.ended) {
    return interaction.reply({ embeds: [errorEmbed('Este sorteio já foi encerrado.')], flags: MessageFlags.Ephemeral });
  }

  const result = stmts.enter.run(giveaway.id, interaction.user.id);
  if (result.changes === 0) {
    return interaction.reply({ embeds: [errorEmbed('Você já está participando deste sorteio!')], flags: MessageFlags.Ephemeral });
  }

  const total = stmts.entryCount.get(giveaway.id).n;
  return interaction.reply({
    embeds: [
      successEmbed(
        `Você entrou no sorteio de **${giveaway.prize}**! (${total} participantes)`,
        `${emoji(interaction.guild, 'giveaway')} Participação confirmada`
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/** Encerra um giveaway: sorteia, edita a mensagem e anuncia. */
async function endGiveaway(client, giveaway) {
  stmts.markEnded.run(giveaway.id);

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const winners = pickWinners(giveaway.id, giveaway.winners_count);
  const winnersText = winners.length
    ? winners.map((id) => `<@${id}>`).join(', ')
    : 'Ninguém participou 😢';

  if (giveaway.message_id) {
    const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    if (message) {
      await message
        .edit({
          embeds: [
            baseEmbed({
              title: `${emoji(giveaway.guild_id, 'giveaway')} Sorteio encerrado: ${giveaway.prize}`,
              description: `**Vencedor(es):** ${winnersText}`,
              color: colors.warning,
              footer: `ID: ${giveaway.id}`,
            }),
          ],
          components: [],
        })
        .catch(() => {});
    }
  }

  await channel
    .send(
      winners.length
        ? `${emoji(giveaway.guild_id, 'giveaway_winner')} Parabéns ${winnersText}! Vocês ganharam **${giveaway.prize}**! (Sorteio #${giveaway.id})`
        : `Sorteio de **${giveaway.prize}** encerrado sem participantes. (Sorteio #${giveaway.id})`
    )
    .catch(() => {});
}

/**
 * Cancela um sorteio: encerra sem sortear nada.
 * Nenhum vencedor é escolhido nem revelado — o registro só é marcado como
 * cancelado, então a varredura periódica também deixa de considerá-lo.
 */
async function cancelGiveaway(client, giveaway, cancelledBy) {
  stmts.markCancelled.run(cancelledBy?.id ?? null, giveaway.id);

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const notice = baseEmbed({
    title: `${emoji(giveaway.guild_id, 'giveaway_cancel')} Sorteio cancelado: ${giveaway.prize}`,
    description:
      'Este sorteio foi interrompido pela organização e **nenhum vencedor foi sorteado**.\n' +
      'As participações registradas não valem mais.',
    color: colors.error,
    footer: `ID: ${giveaway.id}`,
  });

  if (giveaway.message_id) {
    const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
    // Remove os componentes para que ninguém consiga mais participar.
    await message?.edit({ embeds: [notice], components: [] }).catch(() => {});
  }

  await channel
    .send({ embeds: [notice] })
    .catch(() => {});
}

/** Varredura periódica de giveaways vencidos — chamada no ready.js. */
function startGiveawaySweeper(client) {
  const sweep = async () => {
    try {
      for (const giveaway of stmts.pending.all()) {
        await endGiveaway(client, giveaway);
      }
    } catch (err) {
      console.error('[giveaways] Erro na varredura:', err);
    }
  };
  sweep();
  setInterval(sweep, giveawaySettings.sweepIntervalMs);
}

module.exports = {
  handleEntryButton,
  endGiveaway,
  cancelGiveaway,
  pickWinners,
  startGiveawaySweeper,
  listOpenGiveaways,
  autocompleteOpenGiveaways,
  findGuildGiveaway,
};
