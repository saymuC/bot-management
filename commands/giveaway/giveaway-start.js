const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const ms = require('ms');
const dayjs = require('dayjs');
const { db } = require('../../database/db');
const { baseEmbed, successEmbed, errorEmbed } = require('../../utils/embeds');

const insertGiveaway = db.prepare(
  'INSERT INTO giveaways (guild_id, channel_id, prize, winners_count, host_id, ends_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const setMessageId = db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway-start')
    .setDescription('Inicia um sorteio')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('premio').setDescription('Prêmio do sorteio').setRequired(true).setMaxLength(200))
    .addStringOption((opt) => opt.setName('duracao').setDescription('Duração (ex: 30m, 1h, 2d)').setRequired(true))
    .addIntegerOption((opt) =>
      opt.setName('vencedores').setDescription('Quantidade de vencedores (padrão: 1)').setMinValue(1).setMaxValue(20)
    ),

  async execute(interaction) {
    const prize = interaction.options.getString('premio', true);
    const durationRaw = interaction.options.getString('duracao', true);
    const winnersCount = interaction.options.getInteger('vencedores') ?? 1;

    const duration = ms(durationRaw);
    if (!duration || duration < 10_000 || duration > ms('30d')) {
      return interaction.reply({
        embeds: [errorEmbed('Duração inválida. Use entre `10s` e `30d` (ex: `30m`, `1h`, `2d`).')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const endsAt = dayjs().add(duration, 'millisecond');
    // salvo em UTC para casar com datetime('now') do SQLite
    const endsAtUtc = new Date(Date.now() + duration).toISOString().replace('T', ' ').slice(0, 19);
    const endsAtUnix = Math.floor(endsAt.valueOf() / 1000);

    const result = insertGiveaway.run(
      interaction.guild.id, interaction.channel.id, prize, winnersCount, interaction.user.id, endsAtUtc
    );
    const giveawayId = result.lastInsertRowid;

    const message = await interaction.channel.send({
      embeds: [
        baseEmbed({
          title: `🎉 Sorteio: ${prize}`,
          description: [
            `**Vencedores:** ${winnersCount}`,
            `**Encerra:** <t:${endsAtUnix}:R> (<t:${endsAtUnix}:f>)`,
            `**Organizado por:** ${interaction.user}`,
            '',
            'Clique no botão abaixo para participar!',
          ].join('\n'),
          footer: `ID: ${giveawayId}`,
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway_enter_${giveawayId}`)
            .setLabel('Participar')
            .setEmoji('🎉')
            .setStyle(ButtonStyle.Success)
        ),
      ],
    });

    setMessageId.run(message.id, giveawayId);

    return interaction.reply({
      embeds: [successEmbed(`Sorteio **#${giveawayId}** de **${prize}** iniciado! Encerra <t:${endsAtUnix}:R>.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
