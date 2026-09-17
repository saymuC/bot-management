const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { setGuildConfig } = require('../../database/db');
const { canPostEmbed, POST_EMBED_PERMS_LABEL } = require('../../utils/channelPerms');
const { getVerifyPanelConfig } = require('../../utils/verifyPanelConfig');
const { buildSetupPayload } = require('../../handlers/verifySetupHandler');
const { validateAssignableRole } = require('../../utils/assignableRoles');

module.exports = {
  ephemeral: true,
  // Quem pode usar vem de utils/commandPermissions.js (cargos do servidor).
  // `requiredPermission` é só o fallback de quem nunca configurou nada.
  permissionGroup: 'config',
  requiredPermission: PermissionFlagsBits.Administrator,
  data: new SlashCommandBuilder()
    .setName('setup-verify')
    .setDescription('Painel de configuração da verificação por captcha')
    .setDMPermission(false)
    // Opcionais: são só um atalho para já chegar no painel com canal/cargo
    // preenchidos. Toda a configuração (inclusive estes dois) é feita no painel.
    .addChannelOption((opt) =>
      opt
        .setName('canal')
        .setDescription('Atalho: já define o canal do painel')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addRoleOption((opt) =>
      opt.setName('cargo').setDescription('Atalho: já define o cargo de verificado').setRequired(false)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('canal');
    const role = interaction.options.getRole('cargo');
    const notices = [];

    // Os atalhos passam pela mesma validação do painel: melhor recusar aqui do
    // que salvar um canal sem permissão e só descobrir na hora de publicar.
    if (channel) {
      if (canPostEmbed(channel, interaction.guild)) {
        setGuildConfig(interaction.guild.id, 'verify_channel_id', channel.id);
      } else {
        notices.push(`⚠️ Ignorei ${channel}: preciso de ${POST_EMBED_PERMS_LABEL} lá.`);
      }
    }

    if (role) {
      const problem = validateAssignableRole(interaction, role);
      if (problem) {
        notices.push(`⚠️ Ignorei ${role}: ${problem}`);
      } else {
        setGuildConfig(interaction.guild.id, 'verify_role_id', role.id);
      }
    }

    const config = getVerifyPanelConfig(interaction.guild.id);
    return respond(interaction, buildSetupPayload(interaction.guild, config, notices.join('\n')));
  },
};
