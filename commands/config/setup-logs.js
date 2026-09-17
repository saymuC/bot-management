const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { setGuildConfig } = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'config',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('setup-logs')
    .setDescription('Define o canal de logs do servidor')
    .setDMPermission(false)
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal de logs').setRequired(true).addChannelTypes(ChannelType.GuildText)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('canal', true);
    setGuildConfig(interaction.guild.id, 'log_channel_id', channel.id);

    return respond(interaction, {
      embeds: [successEmbed(`Canal de logs definido: ${channel}.\nEventos registrados: mensagens editadas/deletadas, entradas/saídas, bans, warns, tickets e sorteios.`)],
    });
  },
};
