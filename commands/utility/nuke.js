const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');

/** Tipos de canal que podem ser clonados com fidelidade pelo channel.clone(). */
const NUKEABLE = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('nuke')
    .setDescription('Recria o canal atual do zero (apaga todas as mensagens)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addBooleanOption((opt) =>
      opt
        .setName('confirmar')
        .setDescription('Marque true para confirmar — a ação é irreversível')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.options.getBoolean('confirmar', true)) {
      return respond(interaction, {
        embeds: [errorEmbed('Operação cancelada. Use `confirmar: true` para recriar o canal.')],
      });
    }

    const channel = interaction.channel;

    if (!NUKEABLE.has(channel.type)) {
      return respond(interaction, {
        embeds: [errorEmbed('Este tipo de canal não pode ser recriado. Use o comando em um canal de texto ou voz.')],
      });
    }

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me).has(PermissionFlagsBits.ManageChannels)) {
      return respond(interaction, {
        embeds: [errorEmbed('Não tenho permissão de **Gerenciar Canais** neste canal.')],
      });
    }

    const position = channel.position;
    const original = { id: channel.id, name: channel.name };

    let clone;
    try {
      // clone() copia nome, tópico, nsfw, slowmode, bitrate, user limit,
      // categoria e todos os permission overwrites do canal original.
      clone = await channel.clone({
        reason: `/nuke por ${interaction.user.tag}`,
      });
      // O Discord costuma inserir o clone no fim da categoria; reposiciona no lugar do antigo.
      await clone.setPosition(position).catch(() => {});
      await channel.delete(`/nuke por ${interaction.user.tag}`);
    } catch (err) {
      console.error('[nuke] Falha ao recriar canal:', err.message);
      // Se o clone foi criado mas a exclusão falhou, remove a cópia para não duplicar o canal.
      if (clone) await clone.delete('Rollback do /nuke').catch(() => {});
      return respond(interaction, {
        embeds: [errorEmbed('Falha ao recriar o canal. Verifique minhas permissões e a hierarquia de cargos.')],
      }).catch(() => {});
    }

    await clone
      .send({
        embeds: [
          baseEmbed({
            title: '💥 Canal recriado',
            description: `Todas as mensagens foram apagadas por ${interaction.user}.`,
            color: colors.warning,
          }),
        ],
      })
      .catch(() => {});

    await logEvent(
      interaction.guild,
      '💥 Canal recriado (/nuke)',
      `O canal **#${original.name}** foi recriado do zero.`,
      colors.warning,
      [
        { name: 'Responsável', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
        { name: 'Canal novo', value: `${clone} (\`${clone.id}\`)`, inline: true },
        { name: 'Canal antigo', value: `\`${original.id}\``, inline: true },
      ]
    );

    // O canal da interação deixou de existir, então a resposta original é inalcançável.
    return respond(interaction, {
      embeds: [baseEmbed({ title: '💥 Canal recriado', description: `Novo canal: ${clone}` })],
    }).catch(() => {});
  },
};
