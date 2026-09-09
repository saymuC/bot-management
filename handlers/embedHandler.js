/**
 * Fluxo de pré-visualização do /embed.
 *
 * O comando não envia a mensagem direto: ele mostra ao autor um preview
 * efêmero com os botões Enviar / Editar / Excluir, um select para trocar o
 * canal de destino e (quando há mídia) um botão para removê-la.
 * O estado fica em utils/embedDrafts.js, referenciado pelo id no customId.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');

const { baseEmbed, successEmbed, errorEmbed } = require('../utils/embeds');
const { resolveColor, describeColor, colorSelectOptions } = require('../utils/colors');
const { getDraft, updateDraft, deleteDraft } = require('../utils/embedDrafts');
const { classifyUrl } = require('../utils/media');
const { POST_EMBED_PERMS_LABEL, TEXT_CHANNEL_TYPES, canPostEmbed, resolveTextChannel } = require('../utils/channelPerms');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');

const PREFIX = 'embedp_';

/** Valor do select de cor que abre o modal de hex livre. */
const HEX_OPTION = 'hexlivre';

/** Mídia principal: imagem grande do embed, anexo de arquivo e link no corpo. */
const EMPTY_IMAGE = Object.freeze({
  imageUrl: null,
  imageAttachment: null,
  fileAttachment: null,
  linkContent: null,
});

/** Miniatura: imagem pequena no canto superior direito do embed. */
const EMPTY_THUMB = Object.freeze({
  thumbnailUrl: null,
  thumbnailAttachment: null,
});

/** Zera toda a mídia do rascunho (imagem grande + miniatura). */
const EMPTY_MEDIA = Object.freeze({ ...EMPTY_IMAGE, ...EMPTY_THUMB });

/** @returns {boolean} true se o rascunho tem alguma mídia associada. */
const hasMedia = (draft) =>
  Boolean(
    draft.imageUrl ||
      draft.imageAttachment ||
      draft.fileAttachment ||
      draft.linkContent ||
      draft.thumbnailUrl ||
      draft.thumbnailAttachment
  );

/**
 * Acka a interação tolerando token expirado (3s) ou clique que outra instância
 * do bot já respondeu. Nos dois casos abortamos o fluxo em vez de estourar:
 * seguir adiante enviaria o embed duplicado.
 *
 * @returns {Promise<boolean>} false quando o ack falhou e o fluxo deve parar.
 */
const safeAck = makeSafeAck('embed');

/** Componentes do preview: select de canal + linha de ações. */
function previewComponents(draft) {
  const actions = [
    new ButtonBuilder().setCustomId(`${PREFIX}send_${draft.id}`).setLabel('Enviar').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}edit_${draft.id}`).setLabel('Editar').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}delete_${draft.id}`).setLabel('Excluir').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  ];

  if (hasMedia(draft)) {
    actions.splice(
      2,
      0,
      new ButtonBuilder()
        .setCustomId(`${PREFIX}clearmedia_${draft.id}`)
        .setLabel('Remover mídia')
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}channel_${draft.id}`)
        .setPlaceholder('Alterar canal de destino')
        .addChannelTypes(...TEXT_CHANNEL_TYPES)
        .setDefaultChannels(draft.channelId)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}color_${draft.id}`)
        .setPlaceholder(`🎨 Cor do embed — atual: ${describeColor(draft.colorHex)}`)
        .addOptions([
          ...colorSelectOptions(draft.colorHex),
          { label: 'Hex personalizado…', value: HEX_OPTION, emoji: '✏️', description: 'Informar um código como #5865F2' },
        ])
    ),
    new ActionRowBuilder().addComponents(actions),
  ];
}

/** Monta o embed conforme o rascunho (usado no preview e no envio final). */
function draftEmbed(draft, image, thumbnail) {
  return baseEmbed({
    title: draft.title,
    description: draft.description,
    color: resolveColor(draft.colorHex) ?? undefined,
    footer: draft.footer || undefined,
    image,
    thumbnail,
  });
}

/**
 * Payload do preview efêmero.
 *
 * Vídeos/arquivos não são reenviados a cada edição do preview — apenas
 * descritos no texto, para não gastar upload em algo que ainda pode mudar.
 */
function buildPreviewPayload(draft, extraNotice = '') {
  const lines = [`🔎 **Pré-visualização** — só você vê isto. Destino: <#${draft.channelId}>`];
  if (draft.fileAttachment) {
    lines.push(`📎 Anexo \`${draft.fileAttachment.name}\` será enviado junto com a mensagem.`);
  }
  if (draft.linkContent) {
    lines.push(`🔗 ${draft.linkContent} irá no corpo da mensagem (o Discord gera o player/preview desse tipo de link).`);
  }
  if (extraNotice) lines.push(extraNotice);

  return {
    content: lines.join('\n'),
    embeds: [draftEmbed(draft, draft.imageUrl ?? undefined, draft.thumbnailUrl ?? undefined)],
    components: previewComponents(draft),
    files: [],
  };
}

/**
 * Payload real enviado ao canal.
 *
 * Imagens vindas de anexo são reenviadas como arquivo e referenciadas via
 * `attachment://`, porque a URL do CDN do anexo original é assinada e expira.
 * Nomes precisam ser únicos na mesma mensagem: imagem grande e miniatura podem
 * ter subido com o mesmo nome, então o segundo anexo recebe um sufixo.
 */
function buildFinalPayload(draft) {
  const files = [];
  const usedNames = new Set();

  /** Anexa o arquivo garantindo nome único e devolve a referência attachment://. */
  const attach = ({ url, name }) => {
    let unique = name;
    for (let i = 2; usedNames.has(unique); i += 1) {
      unique = name.replace(/(\.[^.]+)?$/, (ext) => `-${i}${ext ?? ''}`);
    }
    usedNames.add(unique);
    files.push(new AttachmentBuilder(url, { name: unique }));
    return `attachment://${unique}`;
  };

  let image = draft.imageUrl ?? undefined;
  let thumbnail = draft.thumbnailUrl ?? undefined;

  if (draft.imageAttachment) image = attach(draft.imageAttachment);
  if (draft.thumbnailAttachment) thumbnail = attach(draft.thumbnailAttachment);
  if (draft.fileAttachment) attach(draft.fileAttachment);

  return {
    content: draft.linkContent ?? undefined,
    embeds: [draftEmbed(draft, image, thumbnail)],
    files,
  };
}

/** Encerra o preview substituindo-o por uma mensagem final sem componentes. */
function closePreview(interaction, embed) {
  return interaction.editReply({ content: '', embeds: [embed], components: [], files: [] });
}

async function handleSend(interaction, draft) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const channel = await interaction.guild.channels.fetch(draft.channelId).catch(() => null);
  if (!channel) {
    deleteDraft(draft.id);
    return closePreview(interaction, errorEmbed('O canal de destino não existe mais.'));
  }
  if (!canPostEmbed(channel, interaction.guild)) {
    return closePreview(interaction, errorEmbed(`Não tenho permissão em ${channel}. Preciso de: ${POST_EMBED_PERMS_LABEL}.`));
  }

  try {
    const sent = await channel.send(buildFinalPayload(draft));
    deleteDraft(draft.id);
    return closePreview(interaction, successEmbed(`Embed enviado em ${channel}. [Ver mensagem](${sent.url})`));
  } catch (err) {
    console.error('[embed] Falha ao enviar embed:', err.message);
    return closePreview(interaction, errorEmbed(`Não consegui enviar em ${channel}. Verifique as permissões do bot.`));
  }
}

function handleDelete(interaction, draft) {
  deleteDraft(draft.id);
  return safeAck(interaction, () =>
    interaction.update({
      content: '',
      embeds: [successEmbed('Rascunho descartado. Nada foi enviado.')],
      components: [],
      files: [],
    })
  );
}

/** Zera toda a mídia do rascunho (anexo, imagem grande, miniatura e link). */
function handleClearMedia(interaction, draft) {
  const updated = updateDraft(draft.id, EMPTY_MEDIA);
  if (!updated) return replyExpired(interaction);
  return safeAck(interaction, () =>
    interaction.update(buildPreviewPayload(updated, '🚫 Mídia removida (imagem grande, miniatura e anexos).'))
  );
}

/** Abre o modal de hex livre (opção "Hex personalizado" do seletor de cor). */
function handleHexModal(interaction, draft) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}hexmodal_${draft.id}`)
    .setTitle('Cor personalizada')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('cor')
          .setLabel('Cor: nome da paleta ou hex')
          .setPlaceholder('azul, fucsia... ou #5865F2')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(30)
          .setRequired(false)
          .setValue(draft.colorHex ?? '')
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('embed', interaction));
}

/** Aplica o hex/nome digitado no modal de cor personalizada. */
function handleHexSubmit(interaction, draft) {
  const colorRaw = interaction.fields.getTextInputValue('cor').trim();

  if (colorRaw && resolveColor(colorRaw) === null) {
    return safeAck(interaction, () =>
      interaction.update(
        buildPreviewPayload(draft, '⚠️ Cor não reconhecida (use um nome como `azul` ou um hex `#5865F2`) — a cor anterior foi mantida.')
      )
    );
  }

  const updated = updateDraft(draft.id, { colorHex: colorRaw || null });
  if (!updated) return replyExpired(interaction);
  return safeAck(interaction, () =>
    interaction.update(buildPreviewPayload(updated, `🎨 Cor alterada para ${describeColor(updated.colorHex)}.`))
  );
}

/** Troca a cor do embed pela paleta nomeada. */
function handleColorSelect(interaction, draft) {
  const colorHex = interaction.values[0];
  if (colorHex === HEX_OPTION) return handleHexModal(interaction, draft);

  const updated = updateDraft(draft.id, { colorHex });
  if (!updated) return replyExpired(interaction);
  return safeAck(interaction, () =>
    interaction.update(buildPreviewPayload(updated, `🎨 Cor alterada para ${describeColor(colorHex)}.`))
  );
}

/** Troca o canal de destino via select menu, validando as permissões do bot. */
async function handleChannelSelect(interaction, draft) {
  const channel = interaction.channels.first();
  if (!channel) return undefined;

  if (!canPostEmbed(channel, interaction.guild)) {
    return safeAck(interaction, () =>
      interaction.update(
        buildPreviewPayload(draft, `⚠️ Não tenho permissão em ${channel} (preciso de: ${POST_EMBED_PERMS_LABEL}). Destino mantido.`)
      )
    );
  }

  const updated = updateDraft(draft.id, { channelId: channel.id });
  if (!updated) return replyExpired(interaction);
  return safeAck(interaction, () => interaction.update(buildPreviewPayload(updated, `📍 Destino alterado para ${channel}.`)));
}

/** Abre o modal de edição já preenchido com os valores atuais. */
function handleEdit(interaction, draft) {
  const mediaValue = draft.imageAttachment || draft.fileAttachment ? '' : draft.imageUrl ?? draft.linkContent ?? '';
  const anexoAviso = draft.imageAttachment || draft.fileAttachment ? 'Preencher aqui substitui o anexo enviado' : 'https://...';
  const thumbValue = draft.thumbnailAttachment ? '' : draft.thumbnailUrl ?? '';
  const thumbAviso = draft.thumbnailAttachment ? 'Preencher aqui substitui a miniatura enviada' : 'https://... (imagem pequena)';

  // O modal do Discord aceita no máximo 5 campos; a cor fica de fora porque o
  // preview já tem o seletor 🎨 (com a opção de hex personalizado).
  const inputs = [
    new TextInputBuilder()
      .setCustomId('titulo')
      .setLabel('Título')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(256)
      .setRequired(true)
      .setValue(draft.title),
    new TextInputBuilder()
      .setCustomId('descricao')
      .setLabel('Descrição (use \\n para quebra de linha)')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true)
      .setValue(draft.description),
    new TextInputBuilder()
      .setCustomId('midia_url')
      .setLabel('Imagem grande: link de imagem/GIF/vídeo')
      .setPlaceholder(anexoAviso)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(500)
      .setRequired(false)
      .setValue(mediaValue),
    new TextInputBuilder()
      .setCustomId('miniatura_url')
      .setLabel('Miniatura: link da imagem pequena (canto)')
      .setPlaceholder(thumbAviso)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(500)
      .setRequired(false)
      .setValue(thumbValue),
    new TextInputBuilder()
      .setCustomId('rodape')
      .setLabel('Rodapé (opcional)')
      .setPlaceholder('Texto pequeno no pé do embed')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(2048)
      .setRequired(false)
      .setValue(draft.footer ?? ''),
  ];

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal_${draft.id}`)
    .setTitle('Editar embed')
    .addComponents(inputs.map((input) => new ActionRowBuilder().addComponents(input)));

  return interaction.showModal(modal).catch(swallowAckFailure('embed', interaction));
}

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
      ...EMPTY_IMAGE,
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
    ? { ...EMPTY_IMAGE, imageUrl: classified.url }
    : { ...EMPTY_IMAGE, linkContent: classified.url };
}

/**
 * Resolve a miniatura após a edição no modal.
 *
 * Miniatura só aceita imagem (o embed não renderiza vídeo nesse campo).
 * Campo vazio preserva a miniatura vinda de anexo e limpa a vinda de link.
 * @param {string[]} warnings acumulador de avisos exibidos ao autor.
 */
function resolveEditedThumbnail(draft, thumbRaw, warnings) {
  const previous = {
    thumbnailUrl: draft.thumbnailUrl ?? null,
    thumbnailAttachment: draft.thumbnailAttachment ?? null,
  };

  if (!thumbRaw) {
    return previous.thumbnailAttachment ? previous : EMPTY_THUMB;
  }

  const classified = classifyUrl(thumbRaw);
  if (!classified) {
    warnings.push('Link da miniatura inválido (use uma URL `http(s)://`) — a miniatura anterior foi mantida.');
    return previous;
  }
  if (classified.kind !== 'image') {
    warnings.push('A miniatura aceita apenas imagem ou GIF (vídeos e links de plataformas não renderizam) — a anterior foi mantida.');
    return previous;
  }
  return { ...EMPTY_THUMB, thumbnailUrl: classified.url };
}

async function handleModalSubmit(interaction, draft) {
  const title = interaction.fields.getTextInputValue('titulo').trim();
  const description = interaction.fields.getTextInputValue('descricao').replaceAll('\\n', '\n');
  const mediaRaw = interaction.fields.getTextInputValue('midia_url').trim();
  const thumbRaw = interaction.fields.getTextInputValue('miniatura_url').trim();
  const footer = interaction.fields.getTextInputValue('rodape').trim();

  const warnings = [];
  const media = resolveEditedMedia(draft, mediaRaw, warnings);
  const thumbnail = resolveEditedThumbnail(draft, thumbRaw, warnings);
  const updated = updateDraft(draft.id, { title, description, footer: footer || null, ...media, ...thumbnail });
  if (!updated) return replyExpired(interaction);

  if (!(await safeAck(interaction, () => interaction.update(buildPreviewPayload(updated))))) return undefined;

  if (warnings.length) {
    await interaction
      .followUp({ embeds: [errorEmbed(warnings.join('\n'), '⚠️ Atenção')], flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  return undefined;
}

const EXPIRED_PAYLOAD = {
  content: '',
  embeds: [errorEmbed('Este rascunho expirou ou o bot foi reiniciado. Rode `/embed` novamente.')],
  components: [],
  files: [],
};

function replyExpired(interaction) {
  if (interaction.isModalSubmit() && !interaction.isFromMessage()) {
    return safeAck(interaction, () => interaction.reply({ ...EXPIRED_PAYLOAD, flags: MessageFlags.Ephemeral }));
  }
  return safeAck(interaction, () => interaction.update(EXPIRED_PAYLOAD));
}

/**
 * Roteia as interações do preview (`embedp_*`).
 * Gerencia o próprio ack: `showModal` não admite defer antes.
 */
async function routeEmbedInteraction(interaction) {
  const rest = interaction.customId.slice(PREFIX.length);
  const separator = rest.indexOf('_');
  if (separator === -1) return undefined;

  const action = rest.slice(0, separator);
  const draft = getDraft(rest.slice(separator + 1));

  if (!draft) return replyExpired(interaction);
  if (draft.userId !== interaction.user.id) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Apenas quem criou este rascunho pode usá-lo.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  switch (action) {
    case 'send':
      return handleSend(interaction, draft);
    case 'edit':
      return handleEdit(interaction, draft);
    case 'delete':
      return handleDelete(interaction, draft);
    case 'clearmedia':
      return handleClearMedia(interaction, draft);
    case 'channel':
      return handleChannelSelect(interaction, draft);
    case 'color':
      return handleColorSelect(interaction, draft);
    case 'modal':
      return handleModalSubmit(interaction, draft);
    case 'hexmodal':
      return handleHexSubmit(interaction, draft);
    default:
      return undefined;
  }
}

module.exports = { PREFIX, EMPTY_MEDIA, buildPreviewPayload, buildFinalPayload, routeEmbedInteraction };
