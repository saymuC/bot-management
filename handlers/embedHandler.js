/**
 * Fluxo de pré-visualização do /embed.
 *
 * O comando não envia a mensagem direto: ele mostra ao autor um preview
 * efêmero com três botões (Enviar / Editar / Excluir). O estado fica em
 * utils/embedDrafts.js e é referenciado pelo id dentro do customId.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');

const { baseEmbed, successEmbed, errorEmbed, parseHexColor } = require('../utils/embeds');
const { getDraft, updateDraft, deleteDraft } = require('../utils/embedDrafts');
const { classifyUrl } = require('../utils/media');

const PREFIX = 'embedp_';

/** Linha de botões do preview. */
function previewComponents(id) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}send_${id}`).setLabel('Enviar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}edit_${id}`).setLabel('Editar').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}delete_${id}`).setLabel('Excluir').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    ),
  ];
}

/** Monta o embed conforme o rascunho (usado no preview e no envio final). */
function draftEmbed(draft, image) {
  return baseEmbed({
    title: draft.title,
    description: draft.description,
    color: parseHexColor(draft.colorHex) ?? undefined,
    image,
  });
}

/**
 * Payload do preview efêmero.
 *
 * Vídeos/arquivos não são reenviados a cada edição do preview — apenas
 * descritos no texto, para não gastar upload em algo que ainda pode mudar.
 */
function buildPreviewPayload(draft) {
  const lines = [`🔎 **Pré-visualização** — só você vê isto. Destino: <#${draft.channelId}>`];
  if (draft.fileAttachment) {
    lines.push(`📎 Anexo \`${draft.fileAttachment.name}\` será enviado junto com a mensagem.`);
  }
  if (draft.linkContent) {
    lines.push(`🔗 O link ${draft.linkContent} será enviado no corpo da mensagem (o Discord gera o player/preview).`);
  }

  return {
    content: lines.join('\n'),
    embeds: [draftEmbed(draft, draft.imageUrl ?? undefined)],
    components: previewComponents(draft.id),
    files: [],
  };
}

/**
 * Payload real enviado ao canal.
 *
 * Imagens vindas de anexo são reenviadas como arquivo e referenciadas via
 * `attachment://`, porque a URL do CDN do anexo original é assinada e expira.
 */
function buildFinalPayload(draft) {
  const files = [];
  let image = draft.imageUrl ?? undefined;

  if (draft.imageAttachment) {
    files.push(new AttachmentBuilder(draft.imageAttachment.url, { name: draft.imageAttachment.name }));
    image = `attachment://${draft.imageAttachment.name}`;
  }
  if (draft.fileAttachment) {
    files.push(new AttachmentBuilder(draft.fileAttachment.url, { name: draft.fileAttachment.name }));
  }

  return {
    content: draft.linkContent ?? undefined,
    embeds: [draftEmbed(draft, image)],
    files,
  };
}

/** Encerra o preview substituindo-o por uma mensagem final sem botões. */
function closePreview(interaction, embed) {
  return interaction.editReply({ content: '', embeds: [embed], components: [], files: [] });
}

async function handleSend(interaction, draft) {
  await interaction.deferUpdate();

  const channel = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
  if (!channel) {
    deleteDraft(draft.id);
    return closePreview(interaction, errorEmbed('O canal de destino não existe mais.'));
  }

  try {
    const sent = await channel.send(buildFinalPayload(draft));
    deleteDraft(draft.id);
    return closePreview(interaction, successEmbed(`Embed enviado em ${channel}. [Ver mensagem](${sent.url})`));
  } catch (err) {
    console.error('[embed] Falha ao enviar embed:', err.message);
    return closePreview(
      interaction,
      errorEmbed(`Não consegui enviar em ${channel}. Verifique as permissões do bot (Ver Canal, Enviar Mensagens, Anexar Arquivos).`)
    );
  }
}

async function handleDelete(interaction, draft) {
  deleteDraft(draft.id);
  return interaction.update({
    content: '',
    embeds: [successEmbed('Rascunho descartado. Nada foi enviado.')],
    components: [],
    files: [],
  });
}

/** Abre o modal de edição já preenchido com os valores atuais. */
function handleEdit(interaction, draft) {
  const mediaValue = draft.imageAttachment ? '' : draft.imageUrl ?? draft.linkContent ?? '';

  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal_${draft.id}`).setTitle('Editar embed');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('titulo')
        .setLabel('Título')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(true)
        .setValue(draft.title)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('descricao')
        .setLabel('Descrição')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true)
        .setValue(draft.description)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('cor')
        .setLabel('Cor hex (ex: #5865F2)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(7)
        .setRequired(false)
        .setValue(draft.colorHex ?? '')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('midia_url')
        .setLabel('Link de imagem/GIF/vídeo (opcional)')
        .setPlaceholder(draft.imageAttachment ? 'Preencher aqui substitui o anexo enviado' : 'https://...')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(mediaValue)
    )
  );

  return interaction.showModal(modal);
}

const EMPTY_MEDIA = Object.freeze({
  imageUrl: null,
  imageAttachment: null,
  fileAttachment: null,
  linkContent: null,
});

/**
 * Resolve a mídia após a edição no modal.
 *
 * O modal não consegue editar anexos, então um link preenchido substitui toda a
 * mídia anterior, e o campo vazio preserva os anexos já enviados.
 * @param {string[]} warnings acumulador de avisos exibidos ao autor.
 */
function resolveEditedMedia(draft, mediaRaw, warnings) {
  const previous = {
    imageUrl: draft.imageUrl ?? null,
    imageAttachment: draft.imageAttachment ?? null,
    fileAttachment: draft.fileAttachment ?? null,
    linkContent: draft.linkContent ?? null,
  };

  if (!mediaRaw) {
    return {
      ...EMPTY_MEDIA,
      imageAttachment: previous.imageAttachment,
      imageUrl: previous.imageAttachment ? previous.imageUrl : null,
      fileAttachment: previous.fileAttachment,
    };
  }

  const classified = classifyUrl(mediaRaw);
  if (!classified) {
    warnings.push('Link de mídia inválido (use uma URL `http(s)://`) — a mídia anterior foi mantida.');
    return previous;
  }
  return classified.kind === 'image'
    ? { ...EMPTY_MEDIA, imageUrl: classified.url }
    : { ...EMPTY_MEDIA, linkContent: classified.url };
}

async function handleModalSubmit(interaction, draft) {
  const title = interaction.fields.getTextInputValue('titulo').trim();
  const description = interaction.fields.getTextInputValue('descricao').replaceAll('\\n', '\n');
  const colorRaw = interaction.fields.getTextInputValue('cor').trim();
  const mediaRaw = interaction.fields.getTextInputValue('midia_url').trim();

  const warnings = [];

  let colorHex = null;
  if (colorRaw) {
    if (parseHexColor(colorRaw) === null) {
      warnings.push('Cor inválida (use o formato `#5865F2`) — a cor anterior foi mantida.');
      colorHex = draft.colorHex ?? null;
    } else {
      colorHex = colorRaw;
    }
  }

  const media = resolveEditedMedia(draft, mediaRaw, warnings);

  const updated = updateDraft(draft.id, { title, description, colorHex, ...media });
  if (!updated) {
    return interaction.update({
      content: '',
      embeds: [errorEmbed('Este rascunho expirou. Rode `/embed` novamente.')],
      components: [],
      files: [],
    });
  }

  await interaction.update(buildPreviewPayload(updated));

  if (warnings.length) {
    await interaction
      .followUp({ embeds: [errorEmbed(warnings.join('\n'), '⚠️ Atenção')], flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  return undefined;
}

/**
 * Roteia as interações do preview (`embedp_*`).
 * Gerencia o próprio ack: `showModal` não admite defer antes.
 */
async function routeEmbedInteraction(interaction) {
  const rest = interaction.customId.slice(PREFIX.length);
  const separator = rest.indexOf('_');
  if (separator === -1) return;

  const action = rest.slice(0, separator);
  const draftId = rest.slice(separator + 1);
  const draft = getDraft(draftId);

  const expired = { embeds: [errorEmbed('Este rascunho expirou. Rode `/embed` novamente.')], content: '', components: [], files: [] };

  if (!draft) {
    if (interaction.isModalSubmit()) return interaction.reply({ ...expired, flags: MessageFlags.Ephemeral });
    return interaction.update(expired);
  }
  if (draft.userId !== interaction.user.id) {
    return interaction.reply({
      embeds: [errorEmbed('Apenas quem criou este rascunho pode usá-lo.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  switch (action) {
    case 'send':
      return handleSend(interaction, draft);
    case 'edit':
      return handleEdit(interaction, draft);
    case 'delete':
      return handleDelete(interaction, draft);
    case 'modal':
      return handleModalSubmit(interaction, draft);
    default:
      return undefined;
  }
}

module.exports = { PREFIX, buildPreviewPayload, buildFinalPayload, routeEmbedInteraction };
