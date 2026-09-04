const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const insertCategory = db.prepare(
  'INSERT INTO ticket_categories (guild_id, label, emoji, target_category_id, support_role_id) VALUES (?, ?, ?, ?, ?)'
);
const countCategories = db.prepare('SELECT COUNT(*) AS n FROM ticket_categories WHERE guild_id = ?');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-add-category')
    .setDescription('Adiciona uma categoria de ticket (ex: Suporte, Bug, Denúncia)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('label').setDescription('Nome (ex: Suporte Geral)').setRequired(true).setMaxLength(50))
    .addStringOption((opt) => opt.setName('emoji').setDescription('Emoji (ex: 🐛)'))
    .addChannelOption((opt) =>
      opt.setName('categoria').setDescription('Categoria do Discord onde criar os canais').addChannelTypes(ChannelType.GuildCategory)
    )
    .addRoleOption((opt) => opt.setName('cargo').setDescription('Cargo de suporte a ser pingado')),

  async execute(interaction) {
    if (countCategories.get(interaction.guild.id).n >= 25) {
      return interaction.reply({
        embeds: [errorEmbed('Limite de 25 categorias atingido (máximo do select menu do Discord).')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const label = interaction.options.getString('label', true);
    const emoji = interaction.options.getString('emoji');
    const category = interaction.options.getChannel('categoria');
    const role = interaction.options.getRole('cargo');

    insertCategory.run(interaction.guild.id, label, emoji, category?.id ?? null, role?.id ?? null);

    return interaction.reply({
      embeds: [
        successEmbed(
          [
            `Categoria **${emoji ?? '🎫'} ${label}** criada.`,
            category ? `Canais serão criados em: **${category.name}**` : 'Canais usarão a categoria padrão do servidor.',
            role ? `Cargo de suporte: ${role}` : 'Sem cargo de suporte definido.',
          ].join('\n')
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
