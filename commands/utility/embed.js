const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { errorEmbed } = require('../../utils/embeds');
const { resolveColor, colorAutocomplete } = require('../../utils/colors');
const { createDraft, getDraft } = require('../../utils/embedDrafts');
const { buildPreviewPayload, EMPTY_MEDIA } = require('../../handlers/embedHandler');
const { classifyAttachment, classifyUrl } = require('../../utils/media');
const { POST_EMBED_PERMS_LABEL, canPostEmbed } = require('../../utils/channelPerms');

/**
 * Traduz um anexo do Discord nos campos de mídia do rascunho.
 * Imagens/GIFs entram no embed; vídeos e outros arquivos vão como anexo da mensagem.
 */
function mediaFromAttachment(attachment) {
  const { kind, url, name } = classifyAttachment(attachment);
  if (kind === 'image') {
    return { ...EMPTY_MEDIA, imageUrl: url, imageAttachment: { url, name } };
  }
  return { ...EMPTY_MEDIA, fileAttachment: { url, name } };
}

/**
 * Resolve a miniatura (imagem pequena no canto do embed) a partir do anexo ou do link.
 *
 * Só imagem/GIF serve: o campo thumbnail do embed não renderiza vídeo nem
 * desdobra links de plataformas. O anexo tem precedência sobre o link.
 * @returns {{ thumbnailUrl: string|null, thumbnailAttachment: object|null }|{ error: string }}
 */
function resolveThumbnail(attachment, urlRaw) {
  if (attachment) {
    const { kind, url, name } = classifyAttachment(attachment);
    if (kind !== 'image') {
      return { error: 'A miniatura aceita apenas imagem ou GIF. Para vídeos, use o campo `anexo`.' };
    }
    return { thumbnailUrl: url, thumbnailAttachment: { url, name } };
  }

  if (!urlRaw) return { thumbnailUrl: null, thumbnailAttachment: null };

  const classified = classifyUrl(urlRaw);
  if (!classified) {
    return { error: 'Link da miniatura inválido. Use uma URL começando com `http://` ou `https://`.' };
  }
  if (classified.kind !== 'image') {
    return { error: 'A miniatura aceita apenas imagem ou GIF (vídeos e links de plataformas não renderizam nesse campo).' };
  }
  return { thumbnailUrl: classified.url, thumbnailAttachment: null };
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Cria um embed personalizado com pré-visualização antes de enviar')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('titulo').setDescription('Título do embed').setRequired(true).setMaxLength(256))
    .addStringOption((opt) => opt.setName('descricao').setDescription('Descrição (use \\n para quebra de linha)').setRequired(true).setMaxLength(4000))
    .addChannelOption((opt) =>
      opt
        .setName('canal')
        .setDescription('Canal de destino (padrão: atual)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption((opt) =>
      opt
        .setName('cor')
        .setDescription('Nome da cor (azul, verde, fúcsia...) ou hex (#5865F2)')
        .setAutocomplete(true)
    )
    .addAttachmentOption((opt) =>
      opt.setName('anexo').setDescription('Imagem grande: arquivo de imagem, GIF ou vídeo')
    )
    .addStringOption((opt) =>
      opt.setName('midia_url').setDescription('Imagem grande: link de imagem, GIF ou vídeo (alternativa ao anexo)')
    )
    .addAttachmentOption((opt) =>
      opt.setName('miniatura').setDescription('Miniatura: imagem pequena no canto superior direito do embed')
    )
    .addStringOption((opt) =>
      opt.setName('miniatura_url').setDescription('Miniatura: link da imagem pequena (alternativa ao anexo)')
    )
    .addStringOption((opt) => opt.setName('rodape').setDescription('Texto pequeno no pé do embed').setMaxLength(2048)),

  /** Sugere as cores da paleta enquanto a pessoa digita. */
  async autocomplete(interaction) {
    if (interaction.options.getFocused(true).name !== 'cor') return interaction.respond([]);
    return interaction.respond(colorAutocomplete(interaction.options.getFocused()));
  },

  async execute(interaction) {
    const title = interaction.options.getString('titulo', true);
    const description = interaction.options.getString('descricao', true).replaceAll('\\n', '\n');
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;
    const colorRaw = interaction.options.getString('cor');
    const attachment = interaction.options.getAttachment('anexo');
    const mediaUrlRaw = interaction.options.getString('midia_url');
    const thumbAttachment = interaction.options.getAttachment('miniatura');
    const thumbUrlRaw = interaction.options.getString('miniatura_url');
    const footer = interaction.options.getString('rodape');

    if (colorRaw && resolveColor(colorRaw) === null) {
      return respond(interaction, {
        embeds: [errorEmbed('Cor não reconhecida. Use um nome da lista (ex: `azul`) ou um hex (ex: `#5865F2`).')],
      });
    }

    if (!canPostEmbed(channel, interaction.guild)) {
      return respond(interaction, {
        embeds: [errorEmbed(`Não tenho permissão suficiente em ${channel}. Preciso de: ${POST_EMBED_PERMS_LABEL}.`)],
      });
    }

    // A mídia pode vir de anexo ou de link. O anexo tem precedência quando ambos
    // são informados, porque é o arquivo que a pessoa acabou de subir.
    let media = EMPTY_MEDIA;

    if (attachment) {
      media = mediaFromAttachment(attachment);
    } else if (mediaUrlRaw) {
      const classified = classifyUrl(mediaUrlRaw);
      if (!classified) {
        return respond(interaction, {
          embeds: [errorEmbed('Link de mídia inválido. Use uma URL começando com `http://` ou `https://`.')],
        });
      }
      media =
        classified.kind === 'image'
          ? { ...EMPTY_MEDIA, imageUrl: classified.url }
          : { ...EMPTY_MEDIA, linkContent: classified.url };
    }

    const thumbnail = resolveThumbnail(thumbAttachment, thumbUrlRaw);
    if (thumbnail.error) {
      return respond(interaction, { embeds: [errorEmbed(thumbnail.error)] });
    }

    const draftId = createDraft({
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      channelId: channel.id,
      title,
      description,
      colorHex: colorRaw ?? null,
      footer: footer ?? null,
      ...media,
      ...thumbnail,
    });

    const notices = [];
    if (attachment && mediaUrlRaw) notices.push('ℹ️ Você enviou anexo e link: o anexo foi usado e o link ignorado.');
    if (thumbAttachment && thumbUrlRaw) notices.push('ℹ️ Miniatura: o anexo foi usado e o link ignorado.');
    return respond(interaction, buildPreviewPayload(getDraft(draftId), notices.join('\n')));
  },
};
