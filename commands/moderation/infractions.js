const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, successEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');
const { formatDuration, parseSqlDate } = require('../../utils/time');
const { RULES, ACTIONS } = require('../../config/automodRules');
const { getAutomodConfig } = require('../../utils/automod/config');
const {
  listInfractions,
  countInfractions,
  clearInfractions,
  activePoints,
  ladderStep,
} = require('../../utils/automod/infractions');

/** Quantas linhas do histórico o embed mostra. */
const HISTORY_LIMIT = 10;

/** Uma linha do histórico. */
function describeRow(row, expireMs, now) {
  const at = parseSqlDate(row.created_at);
  const label = RULES[row.rule_key]?.label ?? row.rule_key;
  const stamp = at ? `<t:${Math.floor(at.getTime() / 1000)}:R>` : 'data desconhecida';
  const expired = at && expireMs > 0 && now - at.getTime() > expireMs;
  const action = row.action && row.action !== 'none' ? ` · ${ACTIONS[row.action]?.label ?? row.action}` : '';

  return `${expired ? '⏳' : '•'} **${label}** (${row.points} pt${row.points === 1 ? '' : 's'}${expired ? ', vencido' : ''})${action}\n` +
    `└ ${stamp}${row.reason ? ` — ${row.reason}` : ''}`;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('infractions')
    .setDescription('Mostra os pontos e o histórico de infrações do AutoMod de um membro')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a consultar').setRequired(true))
    .addBooleanOption((opt) =>
      opt.setName('limpar').setDescription('Apaga o histórico de infrações deste membro (irreversível)')
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const shouldClear = interaction.options.getBoolean('limpar') ?? false;
    const guildId = interaction.guild.id;

    if (shouldClear) {
      const removed = clearInfractions(guildId, user.id);
      return respond(interaction, {
        embeds: [
          successEmbed(
            `${removed} infração(ões) de **${user.tag}** apagadas. Os pontos voltaram a zero.`,
            '🧹 Histórico limpo'
          ),
        ],
      });
    }

    const config = getAutomodConfig(guildId);
    const now = Date.now();
    const expireMs = config.pointsExpireHours * 3600_000;

    const points = activePoints(guildId, user.id, config.pointsExpireHours, now);
    const total = countInfractions(guildId, user.id);
    const rows = listInfractions(guildId, user.id, HISTORY_LIMIT);
    const step = ladderStep(config.ladder, points);

    const next = config.ladder.find((candidate) => candidate.points > points);

    const fields = [
      { name: 'Pontos válidos', value: `**${points}**`, inline: true },
      { name: 'Infrações registradas', value: `${total}`, inline: true },
      { name: 'Pontos vencem em', value: formatDuration(expireMs), inline: true },
      {
        name: 'Degrau atual da escada',
        value: step ? `${step.points} pts → ${ACTIONS[step.action].label}` : 'nenhum',
        inline: true,
      },
      {
        name: 'Próximo degrau',
        value: next ? `${next.points} pts → ${ACTIONS[next.action].label} (faltam ${next.points - points})` : '—',
        inline: true,
      },
    ];

    if (rows.length) {
      fields.push({
        name: `Últimas ${rows.length} de ${total}`,
        value: rows.map((row) => describeRow(row, expireMs, now)).join('\n').slice(0, 1024),
        inline: false,
      });
    }

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'automod')} Infrações de ${user.tag}`,
          description: total
            ? 'As linhas com ⏳ já venceram e não contam para a escada, mas ficam no histórico.'
            : 'Nenhuma infração registrada por aqui.',
          color: points > 0 ? colors.warning : colors.success,
          thumbnail: user.displayAvatarURL(),
          fields,
          footer: `ID: ${user.id}`,
        }),
      ],
    });
  },
};
