const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');

/**
 * Faixas de qualidade (ms). Os limites são generosos de propósito: o gateway do
 * Discord fica nos EUA/Europa, então a distância física já custa 100-180ms para
 * quem está no Brasil — isso não é lentidão do bot.
 */
const QUALITY = Object.freeze([
  { max: 150, label: 'Excelente', emoji: '🟢', color: colors.success },
  { max: 300, label: 'Boa', emoji: '🟡', color: colors.warning },
  { max: 600, label: 'Instável', emoji: '🟠', color: 0xe67e22 },
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

/**
 * Latência do gateway, com plano B.
 *
 * `client.ws.ping` é a média de `shard.ping`, que só sai de -1 quando chega um
 * evento HeartbeatComplete (a cada ~41s) — e vira NaN se ainda não houver shard
 * registrado. Quando não há valor confiável, usamos o tempo de entrega do
 * próprio evento pelo WebSocket, que mede o mesmo caminho de rede.
 *
 * @param {number} raw client.ws.ping
 * @param {number} inbound tempo de entrega da interação pelo WebSocket (ms)
 */
function resolveGateway(raw, inbound) {
  if (Number.isFinite(raw) && raw >= 0) return { value: Math.round(raw), estimated: false };
  return { value: inbound, estimated: true };
}

module.exports = {
  ephemeral: false,
  // Responde direto, sem defer: é justamente o round-trip que queremos medir.
  defer: false,
  data: new SlashCommandBuilder().setName('ping').setDescription('Mostra a latência e o tempo de atividade do bot'),

  async execute(interaction) {
    // Tempo entre o Discord criar a interação e ela chegar aqui pelo WebSocket.
    const inbound = Math.max(Date.now() - interaction.createdTimestamp, 0);

    const before = Date.now();
    await interaction.reply({ embeds: [baseEmbed({ title: '🏓 Medindo...', description: 'Aguarde um instante.' })] });
    // Ida-e-volta de uma chamada REST real ao Discord.
    const outbound = Date.now() - before;

    const gateway = resolveGateway(interaction.client.ws.ping, inbound);
    const quality = rateLatency(gateway.value);

    return interaction.editReply({
      embeds: [
        baseEmbed({
          title: '🏓 Pong!',
          description: `Conexão **${quality.label}** ${quality.emoji}`,
          color: quality.color,
          fields: [
            {
              name: gateway.estimated ? '📡 Gateway (estimado)' : '📡 Gateway (heartbeat)',
              value: gateway.estimated ? `~${gateway.value}ms` : `${gateway.value}ms`,
              inline: true,
            },
            { name: '📥 Entrega até o bot', value: `${inbound}ms`, inline: true },
            { name: '📤 Resposta à API', value: `${outbound}ms`, inline: true },
            { name: '🕒 Online há', value: formatUptime(interaction.client.uptime ?? 0), inline: true },
            { name: '🌐 Servidores', value: `${interaction.client.guilds.cache.size}`, inline: true },
          ],
          footer: 'Latência é a distância até os servidores do Discord, não o desempenho do host',
        }),
      ],
    });
  },
};
