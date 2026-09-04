const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { db } = require('../../database/db');
const { successEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');

const insertWarn = db.prepare(
  'INSERT INTO warns (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)'
);
const countWarns = db.prepare('SELECT COUNT(*) AS n FROM warns WHERE guild_id = ? AND user_id = ?');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Aplica uma advertência a um membro')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a advertir').setRequired(true))
    .addStringOption((opt) => opt.setName('motivo').setDescription('Motivo da advertência').setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const reason = interaction.options.getString('motivo', true);

    insertWarn.run(interaction.guild.id, user.id, interaction.user.id, reason);
    const total = countWarns.get(interaction.guild.id, user.id).n;

    await logEvent(interaction.guild, '⚠️ Warn aplicado',
      `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n**Motivo:** ${reason}\n**Total de warns:** ${total}`,
      colors.warning);

    // tenta avisar por DM (falha silenciosa se fechada)
    await user.send(`⚠️ Você recebeu uma advertência em **${interaction.guild.name}**.\nMotivo: ${reason}`).catch(() => {});

    return respond(interaction, {
      embeds: [successEmbed(`**${user.tag}** advertido (total: **${total}**).\n**Motivo:** ${reason}`, '⚠️ Advertência aplicada')],
    });
  },
};
