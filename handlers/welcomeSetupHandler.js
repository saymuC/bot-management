/**
 * Painel interativo do /setup-welcome.
 *
 * O comando não recebe parâmetros: abre um painel efêmero onde tudo é editado
 * por botões/selects, com a mensagem real renderizada logo abaixo como preview.
 * Cada alteração é gravada na hora (não existe botão "salvar"), então o painel
 * é sempre reconstruído a partir do banco.
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
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { describeColor, colorSelectOptions } = require('../utils/colors');
const { isHttpUrl } = require('../utils/media');
const { POST_EMBED_PERMS_LABEL, TEXT_CHANNEL_TYPES, canPostEmbed } = require('../utils/channelPerms');
const {
  MODES,
  THUMBNAIL_AVATAR,
  THUMBNAIL_NONE,
  DEFAULT_CONFIG,
  PLACEHOLDERS,
  getWelcomeConfig,
  saveWelcomeConfig,
  buildWelcomeMessage,
  normalizeConfig,
} = require('../utils/welcomeConfig');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');

const PREFIX = 'wsetup_';

/** Descrição legível da thumbnail configurada. */
function describeThumbnail(value) {
  if (value === THUMBNAIL_AVATAR) return 'avatar do membro';
  if (!value || value === THUMBNAIL_NONE) return 'nenhuma';
  return 'URL fixa';
}

/** Embed de resumo que fica no topo do painel. */
function panelEmbed(config, guild) {
  const placeholderHelp = Object.entries(PLACEHOLDERS)
    .map(([token, meaning]) => `\`${token}\` ${meaning}`)
    .join(' · ');

  return baseEmbed({
    title: '⚙️ Configuração das boas-vindas',
    description:
      'Tudo abaixo é salvo automaticamente. O **preview** aparece depois deste cartão, exatamente como o membro vai ver.',
    color: config.enabled ? undefined : 0x95a5a6,
    fields: [
      {
        name: 'Status',
        value: config.enabled ? '🟢 Ativado' : '🔴 Desativado',
        inline: true,
      },
      {
        name: 'Canal',
        value: config.channelId ? `<#${config.channelId}>` : '⚠️ nenhum',
        inline: true,
      },
      {
        name: 'Modo',
        value: `${MODES[config.mode].emoji} ${MODES[config.mode].label}`,
        inline: true,
      },
      { name: 'Cor do embed', value: describeColor(config.embed.color), inline: true },
      { name: 'Marcar o membro', value: config.pingUser ? '🔔 sim' : '🔕 não', inline: true },
      { name: 'Thumbnail', value: describeThumbnail(config.embed.thumbnail), inline: true },
      {
        name: 'Imagem grande',
        value: config.embed.imageUrl ? `[definida](${config.embed.imageUrl})` : 'nenhuma',
        inline: true,
      },
      { name: 'Placeholders disponíveis', value: placeholderHelp },
    ],
    footer: `Servidor: ${guild.name}`,
  });
}

/** Linhas de componentes do painel (limite de 5 do Discord). */
function panelComponents(config) {
  const channelRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${PREFIX}channel`)
      .setPlaceholder('📍 Canal das boas-vindas')
      .addChannelTypes(...TEXT_CHANNEL_TYPES)
      .setDefaultChannels(config.channelId ? [config.channelId] : [])
  );

  const modeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}mode`)
      .setPlaceholder(`🎛️ Formato — atual: ${MODES[config.mode].label}`)
      .addOptions(
        Object.entries(MODES).map(([value, meta]) => ({
          label: meta.label,
          value,
          emoji: meta.emoji,
          description: meta.description,
          default: value === config.mode,
        }))
      )
  );

  const colorRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}color`)
      .setPlaceholder(`🎨 Cor do embed — atual: ${describeColor(config.embed.color)}`)
      .addOptions(colorSelectOptions(config.embed.color))
  );

  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}texts`).setLabel('Textos').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}media`).setLabel('Imagens').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}ping`)
      .setLabel(config.pingUser ? 'Marcação: ligada' : 'Marcação: desligada')
      .setEmoji(config.pingUser ? '🔔' : '🔕')
      .setStyle(ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}toggle`)
      .setLabel(config.enabled ? 'Desativar' : 'Ativar')
      .setEmoji(config.enabled ? '🔴' : '🟢')
      .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setDisabled(!config.channelId),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}test`)
      .setLabel('Testar no canal')
      .setEmoji('🧪')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!config.channelId),
    new ButtonBuilder().setCustomId(`${PREFIX}reset`).setLabel('Restaurar padrão').setEmoji('♻️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  return [channelRow, modeRow, colorRow, editRow, actionRow];
}

/**
 * Payload completo do painel: resumo + preview real da mensagem.
 * O membro que está configurando serve de exemplo para os placeholders.
 */
function buildPanelPayload(config, member, notice = '') {
  const preview = buildWelcomeMessage(config, member);
  const header = ['🔧 **Painel de boas-vindas** — só você vê isto.'];
  if (notice) header.push(notice);
  if (preview.content) header.push(`\n**Preview do texto:**\n> ${preview.content.replaceAll('\n', '\n> ')}`);
  if (!config.channelId) header.push('\n⚠️ Escolha um canal para poder ativar.');

  return {
    content: header.join('\n'),
    embeds: [panelEmbed(config, member.guild), ...preview.embeds],
    components: panelComponents(config),
    allowedMentions: { parse: [] },
  };
}

/** Acka tolerando token morto/duplicado (mesma razão do embedHandler). */
const safeAck = makeSafeAck('welcome-setup');

/** Grava a alteração e redesenha o painel. */
function applyChange(interaction, config, changes, notice) {
  const saved = saveWelcomeConfig(interaction.guild.id, { ...config, ...changes });
  return safeAck(interaction, () => interaction.update(buildPanelPayload(saved, interaction.member, notice)));
}

function handleChannelSelect(interaction, config) {
  const channel = interaction.channels.first();
  if (!channel) return undefined;

  if (!canPostEmbed(channel, interaction.guild)) {
    return safeAck(interaction, () =>
      interaction.update(
        buildPanelPayload(config, interaction.member, `⚠️ Não tenho permissão em ${channel} (preciso de: ${POST_EMBED_PERMS_LABEL}).`)
      )
    );
  }
  return applyChange(interaction, config, { channelId: channel.id }, `📍 Canal definido para ${channel}.`);
}

function handleTexts(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-texts`).setTitle('Textos das boas-vindas');

  modal.addComponents(
    [
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Texto fora do embed')
        .setPlaceholder('Seja bem-vindo(a), {user}! 🎉')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(2000)
        .setRequired(false)
        .setValue(config.content ?? ''),
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Título do embed')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false)
        .setValue(config.embed.title ?? ''),
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Descrição do embed')
        .setPlaceholder('Use {user}, {server}, {membercount}... e \\n para quebrar linha')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(false)
        .setValue(config.embed.description ?? ''),
      new TextInputBuilder()
        .setCustomId('footer')
        .setLabel('Rodapé do embed')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(2048)
        .setRequired(false)
        .setValue(config.embed.footer ?? ''),
    ].map((input) => new ActionRowBuilder().addComponents(input))
  );

  return interaction.showModal(modal).catch(swallowAckFailure('welcome-setup', interaction));
}

function handleMedia(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-media`).setTitle('Imagens do embed');

  modal.addComponents(
    [
      new TextInputBuilder()
        .setCustomId('image')
        .setLabel('Imagem grande (URL) — vazio remove')
        .setPlaceholder('https://.../banner.png')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(config.embed.imageUrl ?? ''),
      new TextInputBuilder()
        .setCustomId('thumbnail')
        .setLabel('Thumbnail: avatar, nenhum ou URL')
        .setPlaceholder('avatar')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(config.embed.thumbnail ?? ''),
    ].map((input) => new ActionRowBuilder().addComponents(input))
  );

  return interaction.showModal(modal).catch(swallowAckFailure('welcome-setup', interaction));
}

function handleTextsSubmit(interaction, config) {
  const get = (id) => interaction.fields.getTextInputValue(id).trim();
  return applyChange(
    interaction,
    config,
    {
      content: get('content'),
      embed: { ...config.embed, title: get('title'), description: get('description'), footer: get('footer') },
    },
    '✏️ Textos atualizados.'
  );
}

function handleMediaSubmit(interaction, config) {
  const imageRaw = interaction.fields.getTextInputValue('image').trim();
  const thumbRaw = interaction.fields.getTextInputValue('thumbnail').trim();
  const warnings = [];

  let imageUrl = null;
  if (imageRaw) {
    if (isHttpUrl(imageRaw)) imageUrl = imageRaw;
    else warnings.push('imagem grande ignorada (não é uma URL `http(s)://`)');
  }

  let thumbnail = THUMBNAIL_NONE;
  const thumbLower = thumbRaw.toLowerCase();
  if (thumbLower === THUMBNAIL_AVATAR || thumbLower === 'avatar') thumbnail = THUMBNAIL_AVATAR;
  else if (!thumbRaw || ['nenhum', 'nenhuma', 'none', 'no'].includes(thumbLower)) thumbnail = THUMBNAIL_NONE;
  else if (isHttpUrl(thumbRaw)) thumbnail = thumbRaw;
  else warnings.push('thumbnail ignorada (use `avatar`, `nenhum` ou uma URL)');

  const notice = warnings.length ? `⚠️ ${warnings.join(' · ')}` : '🖼️ Imagens atualizadas.';
  return applyChange(interaction, config, { embed: { ...config.embed, imageUrl, thumbnail } }, notice);
}

/** Envia a mensagem de verdade no canal configurado, para conferir o resultado. */
async function handleTest(interaction, config) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const channel = await interaction.guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel) {
    return interaction.editReply(buildPanelPayload(config, interaction.member, '⚠️ O canal configurado não existe mais.'));
  }

  try {
    await channel.send(buildWelcomeMessage(config, interaction.member));
    return interaction.editReply(buildPanelPayload(config, interaction.member, `🧪 Mensagem de teste enviada em ${channel}.`));
  } catch (err) {
    console.error('[welcome-setup] Falha no teste:', err.message);
    return interaction.editReply(
      buildPanelPayload(config, interaction.member, `⚠️ Não consegui enviar em ${channel}. Confira: ${POST_EMBED_PERMS_LABEL}.`)
    );
  }
}

function handleToggle(interaction, config) {
  if (!config.channelId) {
    return safeAck(interaction, () =>
      interaction.update(buildPanelPayload(config, interaction.member, '⚠️ Defina um canal antes de ativar.'))
    );
  }
  const enabled = !config.enabled;
  return applyChange(interaction, config, { enabled }, enabled ? '🟢 Boas-vindas ativadas!' : '🔴 Boas-vindas desativadas.');
}

function handleReset(interaction, config) {
  // Mantém canal e status: restaurar o texto não deveria desligar a feature.
  const restored = normalizeConfig({ ...DEFAULT_CONFIG, enabled: config.enabled, channelId: config.channelId });
  return applyChange(interaction, restored, {}, '♻️ Textos, cor e imagens voltaram ao padrão.');
}

function handleClose(interaction) {
  return safeAck(interaction, () =>
    interaction.update({
      content: '',
      embeds: [successEmbed('Painel fechado. As configurações já estão salvas.')],
      components: [],
    })
  );
}

/** Roteia as interações do painel (`wsetup_*`). */
async function routeWelcomeSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Apenas administradores podem alterar as boas-vindas.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const action = interaction.customId.slice(PREFIX.length);
  const config = getWelcomeConfig(interaction.guild.id);

  switch (action) {
    case 'channel':
      return handleChannelSelect(interaction, config);
    case 'mode':
      return applyChange(
        interaction,
        config,
        { mode: interaction.values[0] },
        `🎛️ Formato: ${MODES[interaction.values[0]].label}.`
      );
    case 'color':
      return applyChange(
        interaction,
        config,
        { embed: { ...config.embed, color: interaction.values[0] } },
        `🎨 Cor: ${describeColor(interaction.values[0])}.`
      );
    case 'ping':
      return applyChange(
        interaction,
        config,
        { pingUser: !config.pingUser },
        config.pingUser ? '🔕 O membro não será mais marcado.' : '🔔 O membro será marcado na mensagem.'
      );
    case 'texts':
      return handleTexts(interaction, config);
    case 'media':
      return handleMedia(interaction, config);
    case 'modal-texts':
      return handleTextsSubmit(interaction, config);
    case 'modal-media':
      return handleMediaSubmit(interaction, config);
    case 'test':
      return handleTest(interaction, config);
    case 'toggle':
      return handleToggle(interaction, config);
    case 'reset':
      return handleReset(interaction, config);
    case 'close':
      return handleClose(interaction);
    default:
      return undefined;
  }
}

module.exports = { PREFIX, buildPanelPayload, routeWelcomeSetup };
