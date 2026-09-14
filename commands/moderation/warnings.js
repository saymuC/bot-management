const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { db } = require('../../database/db');
const { baseEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');

const listWarns = db.prepare(
  'SELECT * FROM warns WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20'
);

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('Lista as advertências de um membro')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a consultar').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const warns = listWarns.all(interaction.guild.id, user.id);

    const description = warns.length
      ? warns
          .map((w) => `**#${w.id}** — ${w.reason}\n*por <@${w.moderator_id}> em ${w.created_at}*`)
          .join('\n\n')
      : `Nenhuma advertência registrada. ${emoji(interaction.guild, 'success')}`;

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'warn')} Advertências de ${user.tag}`,
          description,
          color: colors.warning,
        }),
      ],
    });
  },
};
