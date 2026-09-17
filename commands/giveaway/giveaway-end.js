const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { errorEmbed, successEmbed, infoEmbed } = require('../../utils/embeds');
const {
  endGiveaway,
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
    .setName('giveaway-end')
    .setDescription('Encerra um sorteio agora, sorteando e anunciando o(s) vencedor(es)')
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
              ? `O sorteio **#${giveaway.id}** foi cancelado e não pode ser sorteado.`
              : `O sorteio **#${giveaway.id}** já foi encerrado. Use \`/giveaway-reroll\` para sortear de novo.`
          ),
        ],
      });
    }

    // endGiveaway edita a mensagem original e anuncia os vencedores no canal do sorteio.
    // Retorna false quando a varredura automática encerrou o sorteio nesse meio-tempo.
    if (!(await endGiveaway(interaction.client, giveaway))) {
      return respond(interaction, {
        embeds: [errorEmbed(`O sorteio **#${giveaway.id}** acabou de ser encerrado por outro processo.`)],
      });
    }

    return respond(interaction, {
      embeds: [
        successEmbed(
          `Sorteio **#${giveaway.id}** (${giveaway.prize}) encerrado antecipadamente.\n` +
            `O resultado foi anunciado em <#${giveaway.channel_id}>.`,
          `${emoji(interaction.guild, 'giveaway')} Sorteio encerrado`
        ),
      ],
    });
  },
};
