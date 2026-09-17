const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { errorEmbed, successEmbed, infoEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const {
  cancelGiveaway,
  autocompleteOpenGiveaways,
  findGuildGiveaway,
  listOpenGiveaways,
} = require('../../handlers/giveawayHandler');
const { emoji } = require('../../utils/emojis');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'giveaways',
  requiredPermission: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName('giveaway-stop')
    .setDescription('Cancela um sorteio em andamento sem sortear nenhum vencedor')
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName('giveaway')
        .setDescription('Sorteio em andamento')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  autocomplete: autocompleteOpenGiveaways,

  async execute(interaction) {
    const raw = interaction.options.getString('giveaway', true);
    const giveaway = findGuildGiveaway(interaction.guild.id, raw);

    if (!giveaway) {
      const open = listOpenGiveaways(interaction.guild.id);
      return respond(interaction, {
        embeds: [
          open.length
            ? errorEmbed('Sorteio não encontrado. Escolha uma das opções sugeridas pelo autocomplete.')
            : infoEmbed(
              'Não há nenhum sorteio em andamento neste servidor.',
              `${emoji(interaction.guild, 'giveaway')} Sorteios`
            ),
        ],
      });
    }
    if (giveaway.ended) {
      return respond(interaction, {
        embeds: [
          errorEmbed(
            giveaway.cancelled
              ? `O sorteio **#${giveaway.id}** já estava cancelado.`
              : `O sorteio **#${giveaway.id}** já foi encerrado e os vencedores foram anunciados.`
          ),
        ],
      });
    }

    // Retorna false quando a varredura automática encerrou o sorteio nesse meio-tempo
    // — nesse caso os vencedores já foram anunciados e cancelar não faz mais sentido.
    if (!(await cancelGiveaway(interaction.client, giveaway, interaction.user))) {
      return respond(interaction, {
        embeds: [errorEmbed(`O sorteio **#${giveaway.id}** acabou de ser encerrado por outro processo.`)],
      });
    }

    const cancelIcon = emoji(interaction.guild, 'giveaway_cancel');
    await logEvent(
      interaction.guild,
      `${cancelIcon} Sorteio cancelado`,
      `O sorteio **#${giveaway.id}** (${giveaway.prize}) foi cancelado sem sorteio de vencedores.`,
      colors.error,
      [
        { name: 'Responsável', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
        { name: 'Canal', value: `<#${giveaway.channel_id}>`, inline: true },
      ]
    );

    return respond(interaction, {
      embeds: [
        successEmbed(
          `Sorteio **#${giveaway.id}** (${giveaway.prize}) cancelado.\n` +
            'Nenhum vencedor foi sorteado nem revelado, e o botão de participação foi removido.',
          `${cancelIcon} Sorteio cancelado`
        ),
      ],
    });
  },
};
