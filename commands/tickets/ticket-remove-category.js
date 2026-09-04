const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { db } = require('../../database/db');
const { successEmbed, errorEmbed } = require('../../utils/embeds');

const listCategories = db.prepare('SELECT id, label FROM ticket_categories WHERE guild_id = ?');
const deleteCategory = db.prepare('DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('ticket-remove-category')
    .setDescription('Remove uma categoria de ticket')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt.setName('id').setDescription('ID da categoria').setRequired(true).setAutocomplete(false)
    ),

  async execute(interaction) {
    const id = interaction.options.getInteger('id', true);
    const result = deleteCategory.run(id, interaction.guild.id);

    if (result.changes === 0) {
      const existing = listCategories.all(interaction.guild.id);
      const list = existing.length
        ? existing.map((c) => `\`${c.id}\` — ${c.label}`).join('\n')
        : 'Nenhuma categoria cadastrada.';
      return respond(interaction, {
        embeds: [errorEmbed(`Categoria \`${id}\` não encontrada. Categorias existentes:\n${list}`)],
      });
    }

    return respond(interaction, {
      embeds: [successEmbed(`Categoria \`${id}\` removida.`)],
    });
  },
};
