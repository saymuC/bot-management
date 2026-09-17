/**
 * Painel interativo do /ticket-config.
 *
 * Substitui os comandos separados de configuração de tickets por um painel
 * efêmero com telas: resumo, painel público, categorias, permissões,
 * comportamento e logs. Cada alteração é gravada na hora — não existe botão
 * "salvar" —, então toda tela é reconstruída do banco a cada clique.
 *
 * Aqui ficam as ações; o desenho das telas mora no `ticketSetupViews`.
 *
 * Não há estado em memória: a tela e a categoria em edição viajam no `customId`
 * (`tsetup_<ação>:<arg>`). Um painel aberto ontem continua respondendo hoje.
 *
 * "Publicar" é a única ação que toca num canal público. Republicar no mesmo
 * canal **edita** a mensagem já publicada em vez de empilhar painéis.
 *
 * customIds (prefixo `tsetup_`):
 *   view:<tela>       navegação (home, panel, cats, perms, behavior, logs)
 *   toggle            liga/desliga o sistema
 *   pchannel          canal do painel público
 *   pcolor            cor do embed (paleta + hex livre)
 *   ptexts            modal: título, descrição, rótulo/emoji do botão e imagem
 *   publish           publica ou atualiza o painel público
 *   catopen           select das categorias → abre a tela da categoria
 *   cat:<id>[:ask]    tela de uma categoria (`ask` = confirmando remoção)
 *   catadd            modal de nova categoria
 *   catedit:<id>      modal de nome/emoji
 *   catparent:<id>    categoria do Discord onde criar os canais
 *   catrole:<id>      cargo de suporte da categoria
 *   catdel:<id>       pede confirmação · catdelyes:<id> remove
 *   defparent         categoria padrão do servidor
 *   staff / managers  cargos de atendimento e de gerência
 *   psoft / pclaim    toggles de permissão
 *   limits            modal: limite por usuário e prazo de exclusão
 *   btranscript / brating / bping / breopen   toggles de comportamento
 *   lchannel          canal de logs · lgeneral volta ao canal geral
 *   lstats            relatório do /ticket-stats numa mensagem separada
 *   close             fecha o painel
 */

const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const { errorEmbed, successEmbed } = require('../utils/embeds');
const { resolveColor, describeColor } = require('../utils/colors');
const { parseEmojiInput } = require('../utils/emojis');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');
const { classifyUrl } = require('../utils/media');
const { POST_EMBED_PERMS_LABEL, canPostEmbed } = require('../utils/channelPerms');
const { LIMITS, DEFAULTS, getTicketConfig, saveTicketConfig } = require('../utils/tickets/config');
const { buildTicketPanel } = require('../utils/tickets/panel');
const {
  listCategories,
  getCategory,
  createCategory,
  renameCategory,
  setCategoryParent,
  setCategoryRole,
  deleteCategory,
} = require('../utils/tickets/categories');
const { PREFIX, VIEWS, MAX_CATEGORIES, HEX_OPTION, buildPanelPayload } = require('./ticketSetupViews');
const { buildStatsPage } = require('./ticketStatsHandler');
const { canUseCommand, PERMISSION_DENIED_MESSAGE } = require('../utils/commandPermissions');

const safeAck = makeSafeAck('ticket-setup');

// ---------------------------------------------------------------------------
// Redesenho
// ---------------------------------------------------------------------------

/** Payload inicial, para o /ticket-config. */
const homeFor = (guild) => buildPanelPayload(guild, getTicketConfig(guild.id));

/** Redesenha sem gravar nada (navegação e avisos). */
function showView(interaction, config, view, notice = '') {
  return safeAck(interaction, () => interaction.update(buildPanelPayload(interaction.guild, config, view, notice)));
}

/** Grava a alteração e redesenha a tela. */
function applyChange(interaction, config, changes, notice, view = 'home') {
  const saved = saveTicketConfig(interaction.guild.id, { ...config, ...changes });
  return showView(interaction, saved, view, notice);
}

/** Grava a alteração de uma seção aninhada (`panel`, `permissions`, `behavior`). */
function applySection(interaction, config, section, changes, notice, view) {
  return applyChange(interaction, config, { [section]: { ...config[section], ...changes } }, notice, view);
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const rowOf = (input) => new ActionRowBuilder().addComponents(input);

const showModal = (interaction, modal) =>
  interaction.showModal(modal).catch(swallowAckFailure('ticket-setup', interaction));

function openPanelTextsModal(interaction, config) {
  const { panel } = config;
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-ptexts`).setTitle('Painel de tickets').addComponents(
    [
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Título (vazio volta ao padrão)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(false)
        .setValue(panel.title ?? ''),
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Descrição (use \\n para quebra de linha)')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(false)
        .setValue(panel.description ?? ''),
      new TextInputBuilder()
        .setCustomId('label')
        .setLabel('Texto do botão')
        .setPlaceholder(DEFAULTS.panelButtonLabel)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setRequired(false)
        .setValue(panel.buttonLabel),
      new TextInputBuilder()
        .setCustomId('emoji')
        // Máximo de 45 caracteres por label; passar disso é recusado pelo Discord.
        .setLabel('Emoji do botão (vazio usa o padrão)')
        .setPlaceholder('🎫 ou <:nome:123456789012345678>')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(64)
        .setRequired(false)
        .setValue(panel.buttonEmoji ?? ''),
      new TextInputBuilder()
        .setCustomId('image')
        .setLabel('Imagem ou GIF (link)')
        .setPlaceholder('https://exemplo.com/banner.gif')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(1024)
        .setRequired(false)
        .setValue(panel.imageUrl ?? ''),
    ].map(rowOf)
  );

  return showModal(interaction, modal);
}

function openHexModal(interaction, config) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-pcolor`)
    .setTitle('Cor personalizada')
    .addComponents(
      rowOf(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Cor: nome da paleta ou hex')
          .setPlaceholder('azul, fucsia... ou #5865F2')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(30)
          .setRequired(false)
          .setValue(config.panel.color ?? '')
      )
    );

  return showModal(interaction, modal);
}

function openLimitsModal(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-limits`).setTitle('Limites e prazos').addComponents(
    [
      new TextInputBuilder()
        .setCustomId('max')
        .setLabel(`Tickets abertos por usuário (${LIMITS.maxOpenPerUser.min}–${LIMITS.maxOpenPerUser.max})`)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(3)
        .setRequired(false)
        .setValue(String(config.maxOpenPerUser)),
      new TextInputBuilder()
        .setCustomId('delay')
        .setLabel(`Segundos antes de apagar o canal (${LIMITS.deleteDelaySeconds.min}–${LIMITS.deleteDelaySeconds.max})`)
        .setStyle(TextInputStyle.Short)
        .setMaxLength(3)
        .setRequired(false)
        .setValue(String(config.behavior.deleteDelaySeconds)),
    ].map(rowOf)
  );

  return showModal(interaction, modal);
}

/** Modal de nome/emoji, para criar (`id` nulo) ou editar uma categoria. */
function openCategoryModal(interaction, category) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-cat:${category?.id ?? 'new'}`)
    .setTitle(category ? 'Editar categoria' : 'Nova categoria')
    .addComponents(
      [
        new TextInputBuilder()
          .setCustomId('label')
          .setLabel('Nome (ex: Suporte Geral)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(50)
          .setRequired(true)
          .setValue(category?.label ?? ''),
        new TextInputBuilder()
          .setCustomId('emoji')
          .setLabel('Emoji (vazio usa o padrão dos tickets)')
          .setPlaceholder('🐛 ou <:nome:123456789012345678>')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(64)
          .setRequired(false)
          .setValue(category?.emoji ?? ''),
      ].map(rowOf)
    );

  return showModal(interaction, modal);
}

// ---------------------------------------------------------------------------
// Submissões
// ---------------------------------------------------------------------------

const field = (interaction, id) => interaction.fields.getTextInputValue(id).trim();

function submitPanelTexts(interaction, config) {
  const notices = [];
  const emojiRaw = field(interaction, 'emoji');

  let buttonEmoji = null;
  if (emojiRaw) {
    const parsed = parseEmojiInput(emojiRaw);
    if (parsed.ok) {
      buttonEmoji = parsed.value;
    } else {
      // Emoji inválido derrubaria o envio do painel inteiro, então mantém o anterior.
      buttonEmoji = config.panel.buttonEmoji;
      notices.push(`emoji mantido — ${parsed.error}`);
    }
  }

  const imageRaw = field(interaction, 'image');
  let imageUrl = null;
  if (imageRaw) {
    const media = classifyUrl(imageRaw);
    if (media?.kind === 'image') {
      imageUrl = media.url;
    } else {
      // Vídeo ou link de plataforma não renderiza dentro do embed; mantém o anterior.
      imageUrl = config.panel.imageUrl;
      notices.push(media ? 'imagem mantida — vídeos e links de plataforma não aparecem no embed' : 'imagem mantida — link inválido');
    }
  }

  return applySection(
    interaction,
    config,
    'panel',
    {
      title: field(interaction, 'title') || null,
      description: field(interaction, 'description').replaceAll('\\n', '\n') || null,
      // Vazio volta ao padrão: um botão sem rótulo é recusado pelo Discord.
      buttonLabel: field(interaction, 'label') || DEFAULTS.panelButtonLabel,
      buttonEmoji,
      imageUrl,
    },
    `✏️ Painel atualizado${notices.length ? ` (${notices.join(' · ')})` : ''}. Clique em **Publicar / atualizar** para aplicar no canal.`,
    'panel'
  );
}

function submitHexColor(interaction, config) {
  const raw = field(interaction, 'color');
  if (raw && resolveColor(raw) === null) {
    return showView(interaction, config, 'panel', '⚠️ Cor não reconhecida (use `azul` ou `#5865F2`) — a anterior foi mantida.');
  }
  return applySection(interaction, config, 'panel', { color: raw || null }, `🎨 Cor: ${describeColor(raw || null)}.`, 'panel');
}

function submitLimits(interaction, config) {
  const max = field(interaction, 'max');
  const delay = field(interaction, 'delay');
  const notices = [];

  // Campo vazio ou não numérico mantém o valor atual em vez de cair no default:
  // o admin abriu o modal para mexer num dos dois, não para resetar o outro.
  const asNumber = (raw, current, label) => {
    if (!raw) return current;
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value)) return value;
    notices.push(`${label} ignorado (informe um número)`);
    return current;
  };

  const saved = saveTicketConfig(interaction.guild.id, {
    ...config,
    maxOpenPerUser: asNumber(max, config.maxOpenPerUser, 'limite'),
    behavior: {
      ...config.behavior,
      deleteDelaySeconds: asNumber(delay, config.behavior.deleteDelaySeconds, 'prazo'),
    },
  });

  const notice = notices.length
    ? `⚠️ ${notices.join(' · ')}.`
    : `🔢 Limite: ${saved.maxOpenPerUser} ticket(s) · prazo: ${saved.behavior.deleteDelaySeconds}s.`;
  return showView(interaction, saved, 'behavior', notice);
}

function submitCategory(interaction, config, arg) {
  const label = field(interaction, 'label');
  const emojiRaw = field(interaction, 'emoji');
  const notices = [];

  if (!label) return showView(interaction, config, 'cats', '⚠️ O nome da categoria não pode ficar vazio.');

  let categoryEmoji = null;
  if (emojiRaw) {
    const parsed = parseEmojiInput(emojiRaw);
    if (parsed.ok) categoryEmoji = parsed.value;
    else notices.push(`emoji ignorado — ${parsed.error}`);
  }

  const suffix = notices.length ? ` (${notices.join(' · ')})` : '';

  if (arg === 'new') {
    if (listCategories(interaction.guild.id).length >= MAX_CATEGORIES) {
      return showView(interaction, config, 'cats', `⚠️ Limite de ${MAX_CATEGORIES} categorias atingido.`);
    }
    const id = createCategory(interaction.guild.id, label, categoryEmoji);
    // Abre direto a tela da nova categoria: canal e cargo ainda faltam, e é lá
    // que eles são escolhidos.
    return showView(interaction, config, `cat:${id}`, `➕ **${label}** criada${suffix}. Defina a categoria e o cargo.`);
  }

  if (!renameCategory(arg, interaction.guild.id, label, categoryEmoji)) {
    return showView(interaction, config, 'cats', '⚠️ Essa categoria não existe mais.');
  }
  return showView(interaction, config, `cat:${arg}`, `✏️ Categoria atualizada${suffix}.`);
}

// ---------------------------------------------------------------------------
// Publicação do painel público
// ---------------------------------------------------------------------------

/**
 * Publica o painel no canal — ou atualiza o que já está lá.
 *
 * Editar em vez de reenviar evita dois painéis no mesmo canal e mantém válido o
 * link que a equipe já divulgou. Se o canal mudou, a mensagem antiga fica onde
 * está: ela continua funcionando, e apagar mensagem por conta própria não é
 * papel de um "publicar".
 */
async function handlePublish(interaction, config) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const redraw = (updated, notice) =>
    interaction.editReply(buildPanelPayload(interaction.guild, updated, 'panel', notice));

  if (!config.panel.channelId) return redraw(config, '⚠️ Escolha o canal antes de publicar.');

  const channel = await interaction.guild.channels.fetch(config.panel.channelId).catch(() => null);
  if (!channel) return redraw(config, '⚠️ O canal configurado não existe mais. Escolha outro.');
  if (!canPostEmbed(channel, interaction.guild)) {
    return redraw(config, `⚠️ Não tenho permissão em ${channel}. Preciso de: ${POST_EMBED_PERMS_LABEL}.`);
  }

  const payload = buildTicketPanel(interaction.guild, config);

  if (config.panel.messageId) {
    const existing = await channel.messages.fetch(config.panel.messageId).catch(() => null);
    if (existing) {
      try {
        await existing.edit(payload);
        return redraw(config, `♻️ Painel atualizado em ${channel}. [Ver mensagem](${existing.url})`);
      } catch (err) {
        console.error('[ticket-setup] Falha ao atualizar o painel:', err.message);
        return redraw(config, `⚠️ Não consegui atualizar a mensagem em ${channel}. Ela ainda existe?`);
      }
    }
  }

  let sent;
  try {
    sent = await channel.send(payload);
  } catch (err) {
    console.error('[ticket-setup] Falha ao publicar o painel:', err.message);
    return redraw(config, `⚠️ Não consegui publicar em ${channel}. Confira as permissões do bot.`);
  }

  const previousChannelId = config.panel.messageId ? config.panel.channelId : null;
  const saved = saveTicketConfig(interaction.guild.id, {
    ...config,
    panel: { ...config.panel, channelId: channel.id, messageId: sent.id },
  });

  const notice = [`📢 Painel publicado em ${channel}. [Ver mensagem](${sent.url})`];
  if (previousChannelId && previousChannelId !== channel.id) {
    notice.push(`ℹ️ O painel antigo em <#${previousChannelId}> continua lá e ainda funciona — apague-o se não quiser dois.`);
  }
  return redraw(saved, notice.join('\n'));
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

/** Roteia as interações do painel (`tsetup_*`). */
async function routeTicketSetup(interaction) {
  if (!canUseCommand(interaction, 'ticket-config')) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed(PERMISSION_DENIED_MESSAGE)],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const [action, arg] = interaction.customId.slice(PREFIX.length).split(':');
  const config = getTicketConfig(interaction.guild.id);
  const guildId = interaction.guild.id;

  switch (action) {
    case 'view':
      return showView(interaction, config, VIEWS.includes(arg) ? arg : 'home');

    case 'toggle':
      return applyChange(
        interaction,
        config,
        { enabled: !config.enabled },
        config.enabled ? '🔴 Sistema de tickets desativado.' : '🟢 Sistema de tickets ativado!'
      );

    // ---- painel público ----
    case 'pchannel': {
      const channel = interaction.channels.first();
      if (!channel) return undefined;
      if (!canPostEmbed(channel, interaction.guild)) {
        return showView(
          interaction,
          config,
          'panel',
          `⚠️ Não tenho permissão em ${channel} (preciso de: ${POST_EMBED_PERMS_LABEL}). Canal mantido.`
        );
      }
      // Trocar de canal invalida a mensagem publicada: ela vive no canal antigo,
      // e editá-la a partir do novo canal falharia.
      const messageId = channel.id === config.panel.channelId ? config.panel.messageId : null;
      return applySection(
        interaction,
        config,
        'panel',
        { channelId: channel.id, messageId },
        `📍 Canal definido para ${channel}.`,
        'panel'
      );
    }
    case 'pcolor': {
      const value = interaction.values[0];
      if (value === HEX_OPTION) return openHexModal(interaction, config);
      return applySection(interaction, config, 'panel', { color: value }, `🎨 Cor: ${describeColor(value)}.`, 'panel');
    }
    case 'ptexts':
      return openPanelTextsModal(interaction, config);
    case 'modal-ptexts':
      return submitPanelTexts(interaction, config);
    case 'modal-pcolor':
      return submitHexColor(interaction, config);
    case 'publish':
      return handlePublish(interaction, config);

    // ---- categorias ----
    case 'catopen':
      return showView(interaction, config, `cat:${interaction.values[0]}`);
    case 'cat':
      return showView(interaction, config, `cat:${arg}`);
    case 'catadd':
      return openCategoryModal(interaction, null);
    case 'catedit':
      return openCategoryModal(interaction, getCategory(arg, guildId));
    case 'modal-cat':
      return submitCategory(interaction, config, arg);
    case 'catparent': {
      const channel = interaction.channels.first();
      if (!channel) return undefined;
      setCategoryParent(arg, guildId, channel.id);
      return showView(interaction, config, `cat:${arg}`, `📁 Canais desta categoria serão criados em **${channel.name}**.`);
    }
    case 'catrole': {
      const role = interaction.roles.first();
      if (!role) return undefined;
      if (role.id === interaction.guild.id) {
        return showView(interaction, config, `cat:${arg}`, '⚠️ O `@everyone` não serve como cargo de suporte.');
      }
      setCategoryRole(arg, guildId, role.id);
      return showView(interaction, config, `cat:${arg}`, `🛡️ Cargo de suporte definido para ${role}.`);
    }
    case 'catdel':
      return showView(interaction, config, `cat:${arg}:ask`);
    case 'catdelyes': {
      const category = getCategory(arg, guildId);
      deleteCategory(arg, guildId);
      return showView(interaction, config, 'cats', `🗑️ **${category?.label ?? arg}** removida do painel.`);
    }
    case 'defparent': {
      const channel = interaction.channels.first();
      if (!channel) return undefined;
      return applyChange(
        interaction,
        config,
        { defaultParentCategoryId: channel.id },
        `📁 Categoria padrão: **${channel.name}**.`,
        'cats'
      );
    }

    // ---- permissões ----
    case 'staff':
      return applySection(
        interaction,
        config,
        'permissions',
        { staffRoleIds: interaction.roles.map((role) => role.id) },
        `🛡️ ${interaction.roles.size} cargo(s) de atendimento.`,
        'perms'
      );
    case 'managers':
      return applySection(
        interaction,
        config,
        'permissions',
        { managerRoleIds: interaction.roles.map((role) => role.id) },
        `👑 ${interaction.roles.size} cargo(s) de gerência.`,
        'perms'
      );
    case 'psoft':
      return applySection(
        interaction,
        config,
        'permissions',
        { allowUserSoftClose: !config.permissions.allowUserSoftClose },
        config.permissions.allowUserSoftClose
          ? '🔴 Só a equipe pode fechar tickets agora.'
          : '🟢 O usuário pode encerrar o próprio lado do ticket.',
        'perms'
      );
    case 'pclaim':
      return applySection(
        interaction,
        config,
        'permissions',
        { requireClaimBeforeFinalClose: !config.permissions.requireClaimBeforeFinalClose },
        config.permissions.requireClaimBeforeFinalClose
          ? '🔴 Encerrar não exige mais reivindicação.'
          : '🟢 Só é possível encerrar um ticket reivindicado.',
        'perms'
      );

    // ---- comportamento ----
    case 'limits':
      return openLimitsModal(interaction, config);
    case 'modal-limits':
      return submitLimits(interaction, config);
    case 'btranscript':
      return applySection(
        interaction,
        config,
        'behavior',
        { createTranscript: !config.behavior.createTranscript },
        config.behavior.createTranscript ? '🔴 Transcript desligado.' : '🟢 Transcript ligado.',
        'behavior'
      );
    case 'brating':
      return applySection(
        interaction,
        config,
        'behavior',
        { sendRatingDm: !config.behavior.sendRatingDm },
        config.behavior.sendRatingDm
          ? '🔴 Avaliação por DM desligada (as estatísticas ficam sem novas notas).'
          : '🟢 Avaliação por DM ligada.',
        'behavior'
      );
    case 'bping':
      return applySection(
        interaction,
        config,
        'behavior',
        { pingSupportRole: !config.behavior.pingSupportRole },
        config.behavior.pingSupportRole ? '🔴 Sem menção ao suporte.' : '🟢 O cargo de suporte será mencionado.',
        'behavior'
      );
    case 'breopen':
      return applySection(
        interaction,
        config,
        'behavior',
        { allowReopen: !config.behavior.allowReopen },
        config.behavior.allowReopen ? '🔴 Reabertura desligada.' : '🟢 Reabertura ligada.',
        'behavior'
      );

    // ---- logs ----
    case 'lchannel': {
      const channel = interaction.channels.first();
      if (!channel) return undefined;
      if (!canPostEmbed(channel, interaction.guild)) {
        return showView(
          interaction,
          config,
          'logs',
          `⚠️ Não tenho permissão em ${channel} (preciso de: ${POST_EMBED_PERMS_LABEL}). Canal mantido.`
        );
      }
      return applyChange(interaction, config, { logChannelId: channel.id }, `📍 Logs em ${channel}.`, 'logs');
    }
    case 'lgeneral':
      return applyChange(
        interaction,
        config,
        { logChannelId: null },
        '↩️ Voltando a usar o canal de logs geral do `/setup-logs`.',
        'logs'
      );
    case 'lstats':
      // Mensagem separada: a paginação do relatório (`tstats_`) edita a mensagem
      // onde vive, e ela levaria o painel de configuração embora.
      return safeAck(interaction, () =>
        interaction.reply({ ...buildStatsPage(guildId, 0), flags: MessageFlags.Ephemeral })
      );

    case 'close':
      return safeAck(interaction, () =>
        interaction.update({
          content: '',
          embeds: [successEmbed('Painel de configuração fechado. As alterações já estão salvas.')],
          components: [],
        })
      );

    default:
      return undefined;
  }
}

module.exports = { PREFIX, VIEWS, MAX_CATEGORIES, buildPanelPayload, homeFor, routeTicketSetup };
