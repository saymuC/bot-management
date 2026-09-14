const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');
const { healthSnapshot } = require('../../utils/observability');

/**
 * Acima disto o heap merece atenção. Não é um limite técnico: é o ponto em que,
 * num host de 512MB (o padrão das hospedagens grátis), o processo começa a
 * flertar com o OOM killer.
 */
const HEAP_WARN_MB = 300;

/** "4 (raid: 3, ticket: 1)" ou "nenhum". */
function describeErrors(errors) {
  if (!errors.total) return 'nenhum desde o último boot';
  const top = Object.entries(errors.byScope)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([scope, count]) => `${scope}: ${count}`)
    .join(', ');
  return `**${errors.total}** (${top})`;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Diagnóstico do bot: uptime, memória, servidores, latência e erros recentes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const snapshot = healthSnapshot(interaction.client);
    const { uptime, memory, discord, errors, runtime } = snapshot;

    const healthy = snapshot.ready && memory.heapUsedMb < HEAP_WARN_MB;
    const mark = emoji(interaction.guild, healthy ? 'success' : snapshot.ready ? 'warning' : 'error');
    const status = !snapshot.ready
      ? 'Gateway desconectado — o bot não está atendendo'
      : healthy
        ? 'Operando normalmente'
        : `Heap acima de ${HEAP_WARN_MB}MB — vale acompanhar`;

    const latency =
      discord.latencyMs === null
        ? 'aguardando heartbeat'
        : `${discord.latencyMs}ms`;

    const fields = [
      { name: 'Uptime do processo', value: uptime.human, inline: true },
      {
        name: 'Memória',
        value: `heap **${memory.heapUsedMb}MB** / ${memory.heapTotalMb}MB\nRSS ${memory.rssMb}MB`,
        inline: true,
      },
      { name: 'Latência do gateway', value: latency, inline: true },
      { name: 'Servidores', value: `${discord.guilds}`, inline: true },
      { name: 'Membros (somados)', value: `${discord.cachedMembers}`, inline: true },
      { name: 'Canais em cache', value: `${discord.channels}`, inline: true },
      { name: 'Erros registrados', value: describeErrors(errors), inline: false },
    ];

    if (errors.recent.length) {
      fields.push({
        name: `Últimos ${errors.recent.length} erros`,
        value: errors.recent
          .map((item) => `\`${item.at.slice(11, 19)}\` **${item.scope}** — ${item.message}`)
          .join('\n')
          .slice(0, 1024),
        inline: false,
      });
    }

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: `${mark} Saúde do bot`,
          description: status,
          color: healthy ? colors.success : snapshot.ready ? colors.warning : colors.error,
          fields,
          footer: `Node ${runtime.node} · discord.js ${runtime.discordJs} · pid ${runtime.pid}`,
        }),
      ],
    });
  },
};
