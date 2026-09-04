const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { db } = require('../../database/db');
const { errorEmbed } = require('../../utils/embeds');
const { pickWinners } = require('../../handlers/giveawayHandler');

const getGiveaway = db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?');

module.exports = {
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
      return interaction.reply({ embeds: [errorEmbed(`Sorteio \`${id}\` não encontrado neste servidor.`)], flags: MessageFlags.Ephemeral });
    }
    if (!giveaway.ended) {
      return interaction.reply({ embeds: [errorEmbed('Este sorteio ainda está em andamento.')], flags: MessageFlags.Ephemeral });
    }

    const winners = pickWinners(giveaway.id, count);
    if (!winners.length) {
      return interaction.reply({ embeds: [errorEmbed('Nenhum participante para sortear.')], flags: MessageFlags.Ephemeral });
    }

    return interaction.reply(
      `🎉 **Reroll do sorteio #${giveaway.id}** (${giveaway.prize}):\nNovo(s) vencedor(es): ${winners.map((w) => `<@${w}>`).join(', ')}`
    );
  },
};
