const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { setGuildConfig } = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('setup-ticket-logs')
    .setDescription('Define o canal de logs exclusivo dos tickets (transcripts e avaliações)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt
        .setName('canal')
        .setDescription('Canal de logs dos tickets (omita para voltar a usar o canal de logs geral)')
        .addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('canal');

    setGuildConfig(interaction.guild.id, 'ticket_log_channel_id', channel?.id ?? null);

    if (!channel) {
      return respond(interaction, {
        embeds: [
          successEmbed('Canal de logs de tickets removido. Os registros voltarão para o canal definido em `/setup-logs`.'),
        ],
      });
    }

    return respond(interaction, {
      embeds: [
        successEmbed(
          `Logs de tickets definidos em ${channel}.\n\n` +
            'Serão registrados ali:\n' +
            '• quem reivindicou cada ticket e quanto tempo o usuário esperou;\n' +
            '• quem fechou, com tempo de atendimento e duração total;\n' +
            '• o transcript completo da conversa em HTML;\n' +
            '• a nota e o comentário da avaliação do atendimento.'
        ),
      ],
    });
  },
};
