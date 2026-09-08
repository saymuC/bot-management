const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { db } = require('../../database/db');
const { errorEmbed } = require('../../utils/embeds');
const { pickWinners } = require('../../handlers/giveawayHandler');
const { emoji } = require('../../utils/emojis');

const getGiveaway = db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('giveaway-reroll')
    .setDescription('Sorteia novo(s) vencedor(es) de um sorteio encerrado')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addIntegerOption((opt) => opt.setName('id').setDescription('ID do sorteio').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('quantidade').setDescription('Quantos novos vencedores (padrão: 1)').setMinValue(1).setMaxValue(20)
    ),

  async execute(interaction) {
    const id = interaction.options.getInteger('id', true);
    const count = interaction.options.getInteger('quantidade') ?? 1;

    const giveaway = getGiveaway.get(id, interaction.guild.id);
    if (!giveaway) {
      return respond(interaction, { embeds: [errorEmbed(`Sorteio \`${id}\` não encontrado neste servidor.`)] });
    }
    if (!giveaway.ended) {
      return respond(interaction, { embeds: [errorEmbed('Este sorteio ainda está em andamento.')] });
    }
    // Um sorteio cancelado nunca teve vencedor; sortear agora contrariaria o /giveaway-stop.
    if (giveaway.cancelled) {
      return respond(interaction, {
        embeds: [errorEmbed('Este sorteio foi cancelado, então não há vencedores a sortear.')],
      });
    }

    const winners = pickWinners(giveaway.id, count);
    if (!winners.length) {
      return respond(interaction, { embeds: [errorEmbed('Nenhum participante para sortear.')] });
    }

    return respond(interaction, 
      `${emoji(interaction.guild, 'giveaway_winner')} **Reroll do sorteio #${giveaway.id}** (${giveaway.prize}):\nNovo(s) vencedor(es): ${winners.map((w) => `<@${w}>`).join(', ')}`
    );
  },
};
