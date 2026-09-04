const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Envia um embed personalizado pelo bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('titulo').setDescription('Título do embed').setRequired(true).setMaxLength(256))
    .addStringOption((opt) => opt.setName('descricao').setDescription('Descrição (use \\n para quebra de linha)').setRequired(true).setMaxLength(4000))
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal de destino (padrão: atual)').addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((opt) => opt.setName('cor').setDescription('Cor hex (ex: #5865F2)')),

  async execute(interaction) {
    const title = interaction.options.getString('titulo', true);
    const description = interaction.options.getString('descricao', true).replaceAll('\\n', '\n');
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;
    const colorRaw = interaction.options.getString('cor');

    let color;
    if (colorRaw) {
      const match = /^#?([0-9a-fA-F]{6})$/.exec(colorRaw.trim());
      if (!match) {
        return respond(interaction, { embeds: [errorEmbed('Cor inválida. Use o formato hex, ex: `#5865F2`.')] });
      }
      color = parseInt(match[1], 16);
    }

    await channel.send({ embeds: [baseEmbed({ title, description, color })] });

    return respond(interaction, {
      embeds: [successEmbed(`Embed enviado em ${channel}.`)],
    });
  },
};
