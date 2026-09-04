const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Envia uma mensagem pelo bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('mensagem').setDescription('Texto a enviar').setRequired(true).setMaxLength(2000))
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal de destino (padrão: atual)').addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    const text = interaction.options.getString('mensagem', true);
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;

    // bloqueia menções em massa mesmo vindo da staff
    await channel.send({ content: text, allowedMentions: { parse: ['users'] } });

    return respond(interaction, {
      embeds: [successEmbed(`Mensagem enviada em ${channel}.`)],
    });
  },
};
