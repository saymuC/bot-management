const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { setGuildConfig } = require('../../database/db');
const { baseEmbed, successEmbed, errorEmbed } = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-verify')
    .setDescription('Configura o sistema de verificação de entrada')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal de verificação').setRequired(true).addChannelTypes(ChannelType.GuildText)
    )
    .addRoleOption((opt) => opt.setName('cargo').setDescription('Cargo dado ao verificar').setRequired(true)),

  async execute(interaction) {
    const channel = interaction.options.getChannel('canal', true);
    const role = interaction.options.getRole('cargo', true);

    if (role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      return interaction.reply({
        embeds: [errorEmbed('Não consigo atribuir este cargo. Coloque o cargo do bot acima do cargo de verificado.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    setGuildConfig(interaction.guild.id, 'verify_channel_id', channel.id);
    setGuildConfig(interaction.guild.id, 'verify_role_id', role.id);

    await channel.send({
      embeds: [
        baseEmbed({
          title: '✅ Verificação',
          description: 'Clique no botão abaixo para se verificar e liberar o acesso ao servidor.',
        }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('verify_button').setLabel('Verificar').setEmoji('✅').setStyle(ButtonStyle.Success)
        ),
      ],
    });

    return interaction.reply({
      embeds: [
        successEmbed(
          `Verificação configurada em ${channel} com o cargo ${role}.\n\n` +
            '💡 Dica: restrinja os canais do servidor para exigir esse cargo, deixando visível apenas o canal de verificação para quem entra.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
