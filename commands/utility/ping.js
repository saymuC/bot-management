const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');

/** Faixas de qualidade da latência do gateway (ms). */
const QUALITY = Object.freeze([
  { max: 100, label: 'Excelente', emoji: '🟢', color: colors.success },
  { max: 250, label: 'Boa', emoji: '🟡', color: colors.warning },
  { max: 500, label: 'Instável', emoji: '🟠', color: 0xe67e22 },
  { max: Infinity, label: 'Ruim', emoji: '🔴', color: colors.error },
]);

function rateLatency(ms) {
  return QUALITY.find((entry) => ms <= entry.max);
}

/** Formata milissegundos como "2d 4h 13m 8s", omitindo as unidades zeradas. */
function formatUptime(ms) {
  const total = Math.floor(ms / 1000);
  const parts = [
    { value: Math.floor(total / 86400), suffix: 'd' },
    { value: Math.floor((total % 86400) / 3600), suffix: 'h' },
    { value: Math.floor((total % 3600) / 60), suffix: 'm' },
    { value: total % 60, suffix: 's' },
  ];
  return parts.filter((part) => part.value > 0).map((part) => `${part.value}${part.suffix}`).join(' ') || '0s';
}

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder().setName('ping').setDescription('Mostra a latência e o tempo de atividade do bot'),

  async execute(interaction) {
    // O roteador já fez deferReply, então a diferença até agora é o tempo real
    // de ida e volta entre o clique do usuário e a resposta do bot.
    const roundtrip = Math.max(Date.now() - interaction.createdTimestamp, 0);
    const gateway = Math.max(interaction.client.ws.ping, 0);
    const quality = rateLatency(gateway);

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: '🏓 Pong!',
          description: `Conexão **${quality.label}** ${quality.emoji}`,
          color: quality.color,
          fields: [
            { name: '📡 Gateway', value: `${gateway}ms`, inline: true },
            { name: '⏱️ Resposta', value: `${roundtrip}ms`, inline: true },
            { name: '🕒 Online há', value: formatUptime(interaction.client.uptime ?? 0), inline: true },
          ],
          footer: `Servidores: ${interaction.client.guilds.cache.size}`,
        }),
      ],
    });
  },
};
