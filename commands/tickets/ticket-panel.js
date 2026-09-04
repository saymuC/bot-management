const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { setGuildConfig } = require('../../database/db');
const { baseEmbed, successEmbed } = require('../../utils/embeds');
const { buildPanelComponents } = require('../../handlers/ticketHandler');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Publica o painel de abertura de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal onde publicar (padrão: atual)').addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((opt) => opt.setName('titulo').setDescription('Título do painel'))
    .addStringOption((opt) => opt.setName('descricao').setDescription('Descrição do painel')),

  async execute(interaction) {
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;
    const title = interaction.options.getString('titulo') ?? '🎫 Central de Atendimento';
    const description =
      interaction.options.getString('descricao') ??
      'Precisa de ajuda? Clique no botão abaixo para abrir um ticket e falar com a nossa equipe.';

    await channel.send({
      embeds: [baseEmbed({ title, description })],
      components: buildPanelComponents(),
    });

    setGuildConfig(interaction.guild.id, 'ticket_panel_channel_id', channel.id);

    return interaction.reply({
      embeds: [successEmbed(`Painel de tickets publicado em ${channel}.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
