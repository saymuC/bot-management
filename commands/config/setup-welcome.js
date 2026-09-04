const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { setGuildConfig } = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-welcome')
    .setDescription('Configura as mensagens de boas-vindas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal das boas-vindas').setRequired(true).addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((opt) =>
      opt.setName('mensagem').setDescription('Mensagem. Placeholders: {user} {username} {server} {membercount}').setMaxLength(1000)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('canal', true);
    const message = interaction.options.getString('mensagem');

    setGuildConfig(interaction.guild.id, 'welcome_channel_id', channel.id);
    if (message) setGuildConfig(interaction.guild.id, 'welcome_message', message);

    return interaction.reply({
      embeds: [
        successEmbed(
          `Boas-vindas configuradas em ${channel}.\n` +
            (message ? `**Mensagem:** ${message}` : 'Usando a mensagem padrão.') +
            '\n\nPlaceholders: `{user}` `{username}` `{server}` `{membercount}`'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
