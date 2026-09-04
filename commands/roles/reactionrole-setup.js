const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags,
} = require('discord.js');
const { db } = require('../../database/db');
const { baseEmbed, successEmbed, errorEmbed } = require('../../utils/embeds');

const insertRR = db.prepare(
  'INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)'
);
const setMessageId = db.prepare('UPDATE reaction_roles SET message_id = ? WHERE id = ?');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole-setup')
    .setDescription('Cria uma mensagem de auto-atribuição de cargo (botão toggle)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addRoleOption((opt) => opt.setName('cargo').setDescription('Cargo a atribuir/remover').setRequired(true))
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Canal da mensagem (padrão: atual)').addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((opt) => opt.setName('mensagem').setDescription('Texto da mensagem'))
    .addStringOption((opt) => opt.setName('emoji').setDescription('Emoji do botão (ex: 🔵)')),

  async execute(interaction) {
    const role = interaction.options.getRole('cargo', true);
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;
    const text = interaction.options.getString('mensagem') ?? `Clique no botão para receber/remover o cargo ${role.name}.`;
    const emoji = interaction.options.getString('emoji') ?? '🎭';

    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      return interaction.reply({
        embeds: [errorEmbed('Meu cargo precisa estar acima do cargo escolhido para eu poder atribuí-lo.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (role.managed || role.id === interaction.guild.roles.everyone.id) {
      return interaction.reply({
        embeds: [errorEmbed('Este cargo não pode ser atribuído manualmente.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // insere primeiro para obter o id usado no customId, depois grava o message_id
    const result = insertRR.run(interaction.guild.id, 'pending', emoji, role.id);
    const entryId = result.lastInsertRowid;

    const message = await channel.send({
      embeds: [baseEmbed({ title: '🎭 Escolha seu cargo', description: text })],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rr_${entryId}`)
            .setLabel(role.name)
            .setEmoji(emoji)
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    setMessageId.run(message.id, entryId);

    return interaction.reply({
      embeds: [successEmbed(`Self-role de ${role} publicado em ${channel}.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
