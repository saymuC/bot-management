/**
 * Painel interativo do /setup-verify.
 *
 * O comando não exige parâmetros: abre um painel efêmero onde canal, cargo e
 * toda a aparência (embed + botão) são editados por selects/modais, com o painel
 * público renderizado logo abaixo como preview. Cada alteração é gravada na hora
 * — não existe botão "salvar" —, então o painel é sempre reconstruído do banco.
 *
 * "Publicar" é a única ação que toca no canal. Republicar no mesmo canal **edita**
 * a mensagem já publicada em vez de empilhar painéis.
 *
 * customIds:
 *   vsetup_channel    canal onde o painel vai (e fica salvo em verify_channel_id)
 *   vsetup_role       cargo entregue a quem passa no captcha
 *   vsetup_color      cor do embed (paleta + opção de hex livre)
 *   vsetup_bstyle     cor do botão (as quatro do Discord)
 *   vsetup_texts      modal: título, descrição, rodapé
 *   vsetup_media      modal: imagem grande e miniatura (URL)
 *   vsetup_button     modal: rótulo e emoji do botão
 *   vsetup_publish    publica ou atualiza o painel no canal
 *   vsetup_close      fecha o painel de configuração
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { resolveColor, describeColor, colorSelectOptions } = require('../utils/colors');
const { getGuildConfig, setGuildConfig } = require('../database/db');
const { isHttpUrl } = require('../utils/media');
const { parseEmojiInput } = require('../utils/emojis');
const { checkCaptchaSupport } = require('../utils/captcha');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');
const { POST_EMBED_PERMS_LABEL, TEXT_CHANNEL_TYPES, canPostEmbed } = require('../utils/channelPerms');
const { buildVerifyPanel } = require('./verifyHandler');
const {
  BUTTON_STYLES,
  NO_EMOJI,
  DEFAULT_CONFIG,
  getVerifyPanelConfig,
  saveVerifyPanelConfig,
  resolveButtonEmoji,
} = require('../utils/verifyPanelConfig');

const PREFIX = 'vsetup_';

/** Valor do select de cor que abre o modal de hex livre (igual ao /embed). */
const HEX_OPTION = 'hexlivre';

/**
 * Canal e cargo salvos: vivem nas colunas do guild_config, não no JSON da
 * aparência, porque é o que o fluxo de verificação lê em tempo de execução.
 */
function readTargets(guild) {
  const row = getGuildConfig(guild.id);
  const channel = row?.verify_channel_id ? guild.channels.cache.get(row.verify_channel_id) ?? null : null;
  const role = row?.verify_role_id ? guild.roles.cache.get(row.verify_role_id) ?? null : null;
  return { channelId: row?.verify_channel_id ?? null, roleId: row?.verify_role_id ?? null, channel, role };
}

/** O bot só consegue entregar cargo abaixo do próprio e não gerenciado por integração. */
function roleProblem(guild, role) {
  if (role.id === guild.id) return 'O `@everyone` não serve como cargo de verificado.';
  if (role.managed) return `${role} é gerenciado por uma integração — o Discord não deixa o bot atribuí-lo.`;
  if (role.position >= guild.members.me.roles.highest.position) {
    return `${role} está acima do cargo do bot na hierarquia. Suba o cargo do bot para poder entregá-lo.`;
  }
  return null;
}

/** Placeholder de select não renderiza markdown: os backticks sairiam literais. */
const plainColor = (value) => describeColor(value).replaceAll('`', '');

/** Descrição legível do botão, já que o preview não tem linha sobrando para ele. */
function describeButton(guild, config) {
  const icon = resolveButtonEmoji(guild, config);
  const style = BUTTON_STYLES[config.button.style];
  return `${icon ? `${icon} ` : ''}**${config.button.label}** · ${style.emoji} ${style.label}`;
}

/** Cartão de resumo no topo do painel. */
function summaryEmbed(guild, config, targets, support) {
  const published = config.message
    ? `<#${config.message.channelId}> · [ver mensagem](https://discord.com/channels/${guild.id}/${config.message.channelId}/${config.message.messageId})`
    : 'ainda não publicado';

  return baseEmbed({
    title: '⚙️ Configuração da verificação',
    description:
      'Tudo aqui é salvo automaticamente. O **preview** do painel público aparece depois deste cartão, ' +
      'exatamente como o membro vai ver — e só vai para o canal quando você clicar em **Publicar**.',
    color: support.ok ? undefined : 0x95a5a6,
    fields: [
      { name: 'Canal do painel', value: targets.channelId ? `<#${targets.channelId}>` : '⚠️ nenhum', inline: true },
      { name: 'Cargo de verificado', value: targets.roleId ? `<@&${targets.roleId}>` : '⚠️ nenhum', inline: true },
      { name: 'Botão', value: describeButton(guild, config), inline: false },
      { name: 'Cor do embed', value: describeColor(config.embed.color), inline: true },
      {
        name: 'Imagem grande',
        value: config.embed.imageUrl ? `[definida](${config.embed.imageUrl})` : 'nenhuma',
        inline: true,
      },
      {
        name: 'Miniatura',
        value: config.embed.thumbnailUrl ? `[definida](${config.embed.thumbnailUrl})` : 'nenhuma',
        inline: true,
      },
      { name: 'Painel publicado', value: published, inline: false },
    ],
    footer: `Servidor: ${guild.name}`,
  });
}

/** As cinco linhas de componentes (limite do Discord). */
function panelComponents(config, targets, canPublish) {
  const styleRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}bstyle`)
      .setPlaceholder(`🔘 Cor do botão — atual: ${BUTTON_STYLES[config.button.style].label}`)
      .addOptions(
        Object.entries(BUTTON_STYLES).map(([value, meta]) => ({
          label: meta.label,
          value,
          emoji: meta.emoji,
          default: value === config.button.style,
        }))
      )
  );

  return [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}channel`)
        .setPlaceholder('📍 Canal do painel de verificação')
        .addChannelTypes(...TEXT_CHANNEL_TYPES)
        .setDefaultChannels(targets.channelId ? [targets.channelId] : [])
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`${PREFIX}role`)
        .setPlaceholder('🎭 Cargo entregue a quem passar no captcha')
        .setDefaultRoles(targets.roleId ? [targets.roleId] : [])
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}color`)
        .setPlaceholder(`🎨 Cor do embed — atual: ${plainColor(config.embed.color)}`)
        .addOptions([
          // A opção de hex ocupa uma das 25 vagas do select, daí o corte em 24.
          ...colorSelectOptions(config.embed.color).slice(0, 24),
          { label: 'Hex personalizado…', value: HEX_OPTION, emoji: '✏️', description: 'Informar um código como #5865F2' },
        ])
    ),
    styleRow,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}texts`).setLabel('Textos').setEmoji('✏️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}media`).setLabel('Imagens').setEmoji('🖼️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}button`).setLabel('Botão').setEmoji('🔘').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}publish`)
        .setLabel(config.message ? 'Publicar / atualizar' : 'Publicar')
        .setEmoji('📢')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!canPublish),
      new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

/** Payload completo do painel: resumo + preview real do painel público. */
function buildSetupPayload(guild, config, notice = '') {
  const targets = readTargets(guild);
  const support = checkCaptchaSupport();
  const preview = buildVerifyPanel(guild, config);

  const header = ['🔧 **Painel de verificação** — só você vê isto.'];
  if (notice) header.push(notice);
  if (!support.ok) header.push(`⛔ Não dá para publicar: ${support.reason}`);
  if (!targets.channelId) header.push('⚠️ Escolha o canal do painel para poder publicar.');
  if (!targets.roleId) header.push('⚠️ Escolha o cargo de verificado para poder publicar.');
  header.push('⬇️ Abaixo, o painel como o membro vai ver (o botão só funciona depois de publicado).');

  const canPublish = Boolean(support.ok && targets.channelId && targets.roleId);

  return {
    content: header.join('\n'),
    embeds: [summaryEmbed(guild, config, targets, support), ...preview.embeds],
    components: panelComponents(config, targets, canPublish),
    allowedMentions: { parse: [] },
  };
}

/** Acka tolerando token morto/duplicado (mesma razão do embedHandler). */
const safeAck = makeSafeAck('verify-setup');

/** Grava a aparência e redesenha o painel. */
function applyChange(interaction, config, changes, notice) {
  const saved = saveVerifyPanelConfig(interaction.guild.id, { ...config, ...changes });
  return safeAck(interaction, () => interaction.update(buildSetupPayload(interaction.guild, saved, notice)));
}

/** Redesenha sem alterar nada (avisos e recusas de validação). */
function refresh(interaction, config, notice) {
  return safeAck(interaction, () => interaction.update(buildSetupPayload(interaction.guild, config, notice)));
}

function handleChannelSelect(interaction, config) {
  const channel = interaction.channels.first();
  if (!channel) return undefined;

  if (!canPostEmbed(channel, interaction.guild)) {
    return refresh(interaction, config, `⚠️ Não tenho permissão em ${channel} (preciso de: ${POST_EMBED_PERMS_LABEL}). Canal mantido.`);
  }

  setGuildConfig(interaction.guild.id, 'verify_channel_id', channel.id);
  return refresh(interaction, config, `📍 Canal definido para ${channel}.`);
}

function handleRoleSelect(interaction, config) {
  const role = interaction.roles.first();
  if (!role) return undefined;

  const problem = roleProblem(interaction.guild, role);
  if (problem) return refresh(interaction, config, `⚠️ ${problem}`);

  setGuildConfig(interaction.guild.id, 'verify_role_id', role.id);
  return refresh(interaction, config, `🎭 Cargo de verificado definido para ${role}.`);
}

function handleTexts(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-texts`).setTitle('Textos do painel');

  modal.addComponents(
    [
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Título (vazio volta ao padrão)')
        .setPlaceholder('✅ Verificação')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false)
        .setValue(config.embed.title ?? ''),
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Descrição (use \\n para quebra de linha)')
        .setPlaceholder('Clique no botão abaixo e resolva o captcha.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(false)
        .setValue(config.embed.description ?? ''),
      new TextInputBuilder()
        .setCustomId('footer')
        .setLabel('Rodapé (opcional)')
        .setPlaceholder('Texto pequeno no pé do embed')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(2048)
        .setRequired(false)
        .setValue(config.embed.footer ?? ''),
    ].map((input) => new ActionRowBuilder().addComponents(input))
  );

  return interaction.showModal(modal).catch(swallowAckFailure('verify-setup', interaction));
}

function handleMedia(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-media`).setTitle('Imagens do painel');

  modal.addComponents(
    [
      new TextInputBuilder()
        .setCustomId('image')
        .setLabel('Imagem grande: URL (vazio remove)')
        .setPlaceholder('https://.../banner.png')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(config.embed.imageUrl ?? ''),
      new TextInputBuilder()
        .setCustomId('thumbnail')
        .setLabel('Miniatura: URL da imagem no canto')
        .setPlaceholder('https://.../icone.png (vazio remove)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(config.embed.thumbnailUrl ?? ''),
    ].map((input) => new ActionRowBuilder().addComponents(input))
  );

  return interaction.showModal(modal).catch(swallowAckFailure('verify-setup', interaction));
}

function handleButton(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-button`).setTitle('Botão de verificação');

  modal.addComponents(
    [
      new TextInputBuilder()
        .setCustomId('label')
        .setLabel('Texto do botão')
        .setPlaceholder('Verificar')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(false)
        .setValue(config.button.label),
      new TextInputBuilder()
        .setCustomId('emoji')
        .setLabel('Emoji: um emoji, `nenhum` ou vazio p/ padrão')
        .setPlaceholder('🔐 ou <:nome:123456789012345678>')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(64)
        .setRequired(false)
        .setValue(config.button.emoji === NO_EMOJI ? 'nenhum' : config.button.emoji ?? ''),
    ].map((input) => new ActionRowBuilder().addComponents(input))
  );

  return interaction.showModal(modal).catch(swallowAckFailure('verify-setup', interaction));
}

/** Abre o modal de hex livre (opção "Hex personalizado" do seletor de cor). */
function handleHexModal(interaction, config) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-hex`)
    .setTitle('Cor personalizada')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Cor: nome da paleta ou hex')
          .setPlaceholder('azul, fucsia... ou #5865F2')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(30)
          .setRequired(false)
          .setValue(config.embed.color ?? '')
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('verify-setup', interaction));
}

function handleTextsSubmit(interaction, config) {
  const get = (id) => interaction.fields.getTextInputValue(id).trim();
  const description = get('description').replaceAll('\\n', '\n');

  return applyChange(
    interaction,
    config,
    { embed: { ...config.embed, title: get('title') || null, description, footer: get('footer') || null } },
    description ? '✏️ Textos atualizados.' : '✏️ Textos atualizados (descrição vazia voltou ao texto padrão).'
  );
}

function handleMediaSubmit(interaction, config) {
  const imageRaw = interaction.fields.getTextInputValue('image').trim();
  const thumbRaw = interaction.fields.getTextInputValue('thumbnail').trim();
  const warnings = [];

  // Vídeo não renderiza dentro de embed, então aqui é só URL de imagem: o campo
  // inválido é recusado com aviso em vez de sumir sem explicação.
  const pick = (raw, label) => {
    if (!raw) return null;
    if (isHttpUrl(raw)) return raw;
    warnings.push(`${label} ignorada (use uma URL \`http(s)://\` de imagem)`);
    return null;
  };

  const imageUrl = pick(imageRaw, 'imagem grande');
  const thumbnailUrl = pick(thumbRaw, 'miniatura');

  return applyChange(
    interaction,
    config,
    { embed: { ...config.embed, imageUrl, thumbnailUrl } },
    warnings.length ? `⚠️ ${warnings.join(' · ')}` : '🖼️ Imagens atualizadas.'
  );
}

function handleButtonSubmit(interaction, config) {
  const labelRaw = interaction.fields.getTextInputValue('label').trim();
  const emojiRaw = interaction.fields.getTextInputValue('emoji').trim();
  const notices = [];

  const label = labelRaw || DEFAULT_CONFIG.button.label;
  if (!labelRaw) notices.push('rótulo vazio voltou para `Verificar`');

  let buttonEmoji = null;
  if (['nenhum', 'nenhuma', 'none', 'no'].includes(emojiRaw.toLowerCase())) {
    buttonEmoji = NO_EMOJI;
    notices.push('botão sem emoji');
  } else if (emojiRaw) {
    const parsed = parseEmojiInput(emojiRaw);
    if (parsed.ok) {
      buttonEmoji = parsed.value;
    } else {
      // Emoji inválido derrubaria o envio do painel inteiro, então mantém o anterior.
      buttonEmoji = config.button.emoji;
      notices.push(`emoji mantido — ${parsed.error}`);
    }
  } else {
    notices.push('emoji vazio: usando o do `/config-emojis`');
  }

  return applyChange(
    interaction,
    config,
    { button: { ...config.button, label, emoji: buttonEmoji } },
    `🔘 Botão atualizado${notices.length ? ` (${notices.join(' · ')})` : ''}.`
  );
}

function handleHexSubmit(interaction, config) {
  const colorRaw = interaction.fields.getTextInputValue('color').trim();

  if (colorRaw && resolveColor(colorRaw) === null) {
    return refresh(interaction, config, '⚠️ Cor não reconhecida (use `azul` ou `#5865F2`) — a anterior foi mantida.');
  }

  return applyChange(
    interaction,
    config,
    { embed: { ...config.embed, color: colorRaw || null } },
    `🎨 Cor do embed: ${describeColor(colorRaw || null)}.`
  );
}

function handleColorSelect(interaction, config) {
  const value = interaction.values[0];
  if (value === HEX_OPTION) return handleHexModal(interaction, config);
  return applyChange(
    interaction,
    config,
    { embed: { ...config.embed, color: value } },
    `🎨 Cor do embed: ${describeColor(value)}.`
  );
}

/**
 * Publica o painel no canal — ou atualiza o que já está lá.
 *
 * Editar em vez de reenviar evita dois painéis no mesmo canal e mantém válido o
 * link que a staff já divulgou. Se o canal mudou, a mensagem antiga fica onde
 * está: ela continua funcionando, e apagar mensagem por conta própria não é papel
 * de um "publicar".
 */
async function handlePublish(interaction, config) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const redraw = (updated, notice) => interaction.editReply(buildSetupPayload(interaction.guild, updated, notice));

  const support = checkCaptchaSupport();
  if (!support.ok) return redraw(config, `⛔ Publicação cancelada: ${support.reason}`);

  const { channelId, roleId } = readTargets(interaction.guild);
  if (!channelId || !roleId) return redraw(config, '⚠️ Defina canal e cargo antes de publicar.');

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) return redraw(config, '⚠️ O cargo configurado não existe mais. Escolha outro.');
  const problem = roleProblem(interaction.guild, role);
  if (problem) return redraw(config, `⚠️ ${problem}`);

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return redraw(config, '⚠️ O canal configurado não existe mais. Escolha outro.');
  if (!canPostEmbed(channel, interaction.guild)) {
    return redraw(config, `⚠️ Não tenho permissão em ${channel}. Preciso de: ${POST_EMBED_PERMS_LABEL}.`);
  }

  const payload = buildVerifyPanel(interaction.guild, config);

  if (config.message?.channelId === channel.id) {
    const existing = await channel.messages.fetch(config.message.messageId).catch(() => null);
    if (existing) {
      try {
        await existing.edit(payload);
        return redraw(config, `♻️ Painel atualizado em ${channel}. [Ver mensagem](${existing.url})`);
      } catch (err) {
        console.error('[verify-setup] Falha ao atualizar o painel:', err.message);
        return redraw(config, `⚠️ Não consegui atualizar a mensagem em ${channel}. Ela ainda existe?`);
      }
    }
  }

  let sent;
  try {
    sent = await channel.send(payload);
  } catch (err) {
    console.error('[verify-setup] Falha ao publicar o painel:', err.message);
    return redraw(config, `⚠️ Não consegui publicar em ${channel}. Confira as permissões do bot.`);
  }

  const previous = config.message;
  const saved = saveVerifyPanelConfig(interaction.guild.id, {
    ...config,
    message: { channelId: channel.id, messageId: sent.id },
  });

  const notice = [`📢 Painel publicado em ${channel}. [Ver mensagem](${sent.url})`];
  if (previous && previous.channelId !== channel.id) {
    notice.push(`ℹ️ O painel antigo em <#${previous.channelId}> continua lá e ainda funciona — apague-o se não quiser dois.`);
  }
  return redraw(saved, notice.join('\n'));
}

function handleClose(interaction) {
  return safeAck(interaction, () =>
    interaction.update({
      content: '',
      embeds: [successEmbed('Painel de configuração fechado. As alterações já estão salvas.')],
      components: [],
    })
  );
}

/** Roteia as interações do painel (`vsetup_*`). */
async function routeVerifySetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Apenas administradores podem alterar a verificação.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const action = interaction.customId.slice(PREFIX.length);
  const config = getVerifyPanelConfig(interaction.guild.id);

  switch (action) {
    case 'channel':
      return handleChannelSelect(interaction, config);
    case 'role':
      return handleRoleSelect(interaction, config);
    case 'color':
      return handleColorSelect(interaction, config);
    case 'bstyle':
      return applyChange(
        interaction,
        config,
        { button: { ...config.button, style: interaction.values[0] } },
        `🔘 Cor do botão: ${BUTTON_STYLES[interaction.values[0]].label}.`
      );
    case 'texts':
      return handleTexts(interaction, config);
    case 'media':
      return handleMedia(interaction, config);
    case 'button':
      return handleButton(interaction, config);
    case 'modal-texts':
      return handleTextsSubmit(interaction, config);
    case 'modal-media':
      return handleMediaSubmit(interaction, config);
    case 'modal-button':
      return handleButtonSubmit(interaction, config);
    case 'modal-hex':
      return handleHexSubmit(interaction, config);
    case 'publish':
      return handlePublish(interaction, config);
    case 'close':
      return handleClose(interaction);
    default:
      return undefined;
  }
}

module.exports = { PREFIX, buildSetupPayload, routeVerifySetup };
