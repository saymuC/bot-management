/**
 * Painel interativo do /ticket-config.
 *
 * Substitui os comandos separados de configuração de tickets por um painel
 * efêmero com telas: resumo, painel público, categorias, permissões,
 * comportamento e logs. Cada alteração é gravada na hora — não existe botão
 * "salvar" —, então toda tela é reconstruída do banco a cada clique.
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
 *   ptexts            modal: título, descrição, rótulo e emoji do botão
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
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const { db, getGuildConfig } = require('../database/db');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { resolveColor, describeColor, colorSelectOptions } = require('../utils/colors');
const { emoji, parseEmojiInput } = require('../utils/emojis');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');
const { POST_EMBED_PERMS_LABEL, TEXT_CHANNEL_TYPES, canPostEmbed } = require('../utils/channelPerms');
const { LIMITS, DEFAULTS, getTicketConfig, saveTicketConfig } = require('../utils/tickets/config');
const { buildTicketPanel } = require('../utils/tickets/panel');
const { buildStatsPage } = require('./ticketStatsHandler');

const PREFIX = 'tsetup_';

const safeAck = makeSafeAck('ticket-setup');

/** Telas do painel. É o único estado da navegação. */
const VIEWS = Object.freeze(['home', 'panel', 'cats', 'perms', 'behavior', 'logs']);

/** Teto do select de categorias do painel público. */
const MAX_CATEGORIES = 25;

/** Valor do select de cor que abre o modal de hex livre (igual ao /setup-verify). */
const HEX_OPTION = 'hexlivre';

const stmts = {
  list: db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id'),
  byId: db.prepare('SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?'),
  insert: db.prepare(
    'INSERT INTO ticket_categories (guild_id, label, emoji, target_category_id, support_role_id) VALUES (?, ?, ?, ?, ?)'
  ),
  updateMeta: db.prepare('UPDATE ticket_categories SET label = ?, emoji = ? WHERE id = ? AND guild_id = ?'),
  updateParent: db.prepare('UPDATE ticket_categories SET target_category_id = ? WHERE id = ? AND guild_id = ?'),
  updateRole: db.prepare('UPDATE ticket_categories SET support_role_id = ? WHERE id = ? AND guild_id = ?'),
  remove: db.prepare('DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?'),
};

// ---------------------------------------------------------------------------
// Diagnóstico: configuração salva que não faz nada
// ---------------------------------------------------------------------------

const onOff = (value) => (value ? '🟢 sim' : '🔴 não');

/**
 * Avisos do que está configurado mas inerte, ou faltando para o sistema rodar.
 *
 * Existe porque um ticket que não abre é um erro que só aparece do lado do
 * membro: sem estas linhas o admin só descobre a categoria apagada quando
 * alguém reclama.
 */
function idleWarnings(guild, config, categories) {
  const warnings = [];

  if (!config.enabled) warnings.push('o sistema está **desativado**: o botão do painel recusa novos tickets.');
  if (!categories.length) warnings.push('nenhuma categoria cadastrada: o botão do painel não tem o que oferecer.');

  if (!config.panel.channelId) {
    warnings.push('o painel público ainda não foi publicado — ninguém consegue abrir ticket.');
  } else {
    const channel = guild.channels.cache.get(config.panel.channelId);
    if (!channel) warnings.push('o canal do painel público não existe mais.');
    else if (!canPostEmbed(channel, guild)) warnings.push(`sem permissão em ${channel} para publicar o painel.`);
    else if (!config.panel.messageId) warnings.push('o canal do painel está definido, mas a mensagem nunca foi publicada.');
  }

  if (config.defaultParentCategoryId && !guild.channels.cache.get(config.defaultParentCategoryId)) {
    warnings.push('a categoria padrão do servidor não existe mais: os canais serão criados fora de categoria.');
  }

  if (!config.logChannelId && !getGuildConfig(guild.id)?.log_channel_id) {
    warnings.push('sem canal de logs: transcripts, avaliações e fechamentos não serão registrados em lugar nenhum.');
  }

  const brokenParents = categories.filter((c) => c.target_category_id && !guild.channels.cache.get(c.target_category_id));
  if (brokenParents.length) {
    warnings.push(`categoria do Discord apagada em: ${brokenParents.map((c) => `**${c.label}**`).join(', ')}.`);
  }

  const brokenRoles = categories.filter((c) => c.support_role_id && !guild.roles.cache.get(c.support_role_id));
  if (brokenRoles.length) {
    warnings.push(`cargo de suporte apagado em: ${brokenRoles.map((c) => `**${c.label}**`).join(', ')}.`);
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Tela inicial
// ---------------------------------------------------------------------------

const describeRoles = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : 'nenhum');

function homeEmbed(guild, config, categories) {
  const warnings = idleWarnings(guild, config, categories);
  const logChannelId = config.logChannelId ?? getGuildConfig(guild.id)?.log_channel_id ?? null;

  return baseEmbed({
    title: `${emoji(guild, 'ticket')} Configuração dos tickets`,
    description: ['Tudo abaixo é salvo automaticamente.', warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : '']
      .filter(Boolean)
      .join('\n'),
    color: config.enabled ? undefined : 0x95a5a6,
    fields: [
      { name: 'Status', value: config.enabled ? '🟢 Ativado' : '🔴 Desativado', inline: true },
      { name: 'Categorias', value: `${categories.length} de ${MAX_CATEGORIES}`, inline: true },
      { name: 'Limite por usuário', value: `${config.maxOpenPerUser} ticket(s)`, inline: true },
      {
        name: 'Painel público',
        value: config.panel.messageId
          ? `<#${config.panel.channelId}> · [ver mensagem](https://discord.com/channels/${guild.id}/${config.panel.channelId}/${config.panel.messageId})`
          : config.panel.channelId
            ? `<#${config.panel.channelId}> · ⚠️ não publicado`
            : '⚠️ nenhum canal',
        inline: false,
      },
      { name: 'Canal de logs', value: logChannelId ? `<#${logChannelId}>` : '⚠️ nenhum', inline: true },
      {
        name: 'Categoria padrão',
        value: config.defaultParentCategoryId ? `<#${config.defaultParentCategoryId}>` : 'nenhuma',
        inline: true,
      },
      { name: 'Atendimento', value: describeRoles(config.permissions.staffRoleIds), inline: false },
      { name: 'Gerência', value: describeRoles(config.permissions.managerRoleIds), inline: false },
      {
        name: 'Comportamento',
        value: [
          `Transcript: ${onOff(config.behavior.createTranscript)}`,
          `Avaliação por DM: ${onOff(config.behavior.sendRatingDm)}`,
          `Ping do suporte: ${onOff(config.behavior.pingSupportRole)}`,
          `Reabertura: ${onOff(config.behavior.allowReopen)}`,
          `Usuário pode fechar: ${onOff(config.permissions.allowUserSoftClose)}`,
        ].join(' · '),
        inline: false,
      },
    ],
    footer: `Servidor: ${guild.name}`,
  });
}

const viewButton = (view, label, icon) =>
  new ButtonBuilder().setCustomId(`${PREFIX}view:${view}`).setLabel(label).setEmoji(icon).setStyle(ButtonStyle.Secondary);

const backButton = (view = 'home') =>
  new ButtonBuilder().setCustomId(`${PREFIX}view:${view}`).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary);

function homeComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}toggle`)
        .setLabel(config.enabled ? 'Desativar' : 'Ativar')
        .setEmoji(config.enabled ? '🔴' : '🟢')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      viewButton('panel', 'Painel público', '📢'),
      viewButton('cats', 'Categorias', '🗂️'),
      viewButton('perms', 'Permissões', '🛡️'),
      viewButton('behavior', 'Comportamento', '⚙️')
    ),
    new ActionRowBuilder().addComponents(
      viewButton('logs', 'Logs e estatísticas', '📊'),
      new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ---------------------------------------------------------------------------
// Tela do painel público
// ---------------------------------------------------------------------------

/** Placeholder de select não renderiza markdown: os backticks sairiam literais. */
const plainColor = (value) => describeColor(value).replaceAll('`', '');

function panelPayload(guild, config, notice) {
  const preview = buildTicketPanel(guild, config);
  const channel = config.panel.channelId ? guild.channels.cache.get(config.panel.channelId) : null;

  const header = ['📢 **Painel público de abertura** — só você vê isto.'];
  if (notice) header.push(notice);
  if (!config.panel.channelId) header.push('⚠️ Escolha o canal para poder publicar.');
  else if (channel && !canPostEmbed(channel, guild)) {
    header.push(`⚠️ Não tenho permissão em ${channel} (preciso de: ${POST_EMBED_PERMS_LABEL}).`);
  }
  header.push('⬇️ Abaixo, o painel como o membro vai ver (o botão só funciona depois de publicado).');

  return {
    content: header.join('\n'),
    embeds: preview.embeds,
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}pchannel`)
          .setPlaceholder('📍 Canal do painel de tickets')
          .addChannelTypes(...TEXT_CHANNEL_TYPES)
          .setDefaultChannels(config.panel.channelId ? [config.panel.channelId] : [])
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}pcolor`)
          .setPlaceholder(`🎨 Cor do embed — atual: ${plainColor(config.panel.color)}`)
          .addOptions([
            // A opção de hex ocupa uma das 25 vagas do select, daí o corte em 24.
            ...colorSelectOptions(config.panel.color).slice(0, 24),
            { label: 'Hex personalizado…', value: HEX_OPTION, emoji: '✏️', description: 'Informar um código como #5865F2' },
          ])
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}ptexts`)
          .setLabel('Textos e botão')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}publish`)
          .setLabel(config.panel.messageId ? 'Publicar / atualizar' : 'Publicar')
          .setEmoji('📢')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!config.panel.channelId),
        backButton()
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Telas de categorias
// ---------------------------------------------------------------------------

function categoryLine(guild, category) {
  const parent = category.target_category_id ? `<#${category.target_category_id}>` : 'categoria padrão';
  const role = category.support_role_id ? `<@&${category.support_role_id}>` : 'sem cargo';
  return `${category.emoji ?? emoji(guild, 'ticket')} **${category.label}** — ${parent} · ${role}`;
}

function catsPayload(guild, config, categories, notice) {
  const full = categories.length >= MAX_CATEGORIES;

  const rows = [];
  if (categories.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}catopen`)
          .setPlaceholder('🗂️ Escolha uma categoria para editar ou remover')
          .addOptions(
            categories.slice(0, MAX_CATEGORIES).map((category) => ({
              label: category.label.slice(0, 100),
              value: String(category.id),
              emoji: category.emoji ?? emoji(guild, 'ticket'),
            }))
          )
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}defparent`)
        .setPlaceholder('📁 Categoria padrão (usada quando a do ticket não define uma)')
        .addChannelTypes(ChannelType.GuildCategory)
        .setDefaultChannels(config.defaultParentCategoryId ? [config.defaultParentCategoryId] : [])
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}catadd`)
        .setLabel('Adicionar categoria')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Success)
        .setDisabled(full),
      backButton()
    )
  );

  return {
    content: notice || '🗂️ **Categorias de atendimento** — só você vê isto.',
    embeds: [
      baseEmbed({
        title: '🗂️ Categorias de atendimento',
        description: categories.length
          ? categories.map((category) => categoryLine(guild, category)).join('\n')
          : 'Nenhuma categoria cadastrada. Sem pelo menos uma, o botão do painel não abre nada.',
        fields: full ? [{ name: 'Limite', value: `${MAX_CATEGORIES} categorias — teto do select do Discord.` }] : [],
        footer: `Servidor: ${guild.name}`,
      }),
    ],
    components: rows,
    allowedMentions: { parse: [] },
  };
}

/** Tela de uma categoria. `asking` mostra a confirmação da remoção. */
function catPayload(guild, category, notice, asking) {
  return {
    content: notice || `🗂️ **${category.label}** — só você vê isto.`,
    embeds: [
      baseEmbed({
        title: `${category.emoji ?? emoji(guild, 'ticket')} ${category.label}`,
        description: asking
          ? '⚠️ Remover a categoria só a tira do painel: os tickets já abertos e o histórico continuam intactos.'
          : categoryLine(guild, category),
        color: asking ? 0xed4245 : undefined,
        footer: `Categoria #${category.id}`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}catparent:${category.id}`)
          .setPlaceholder('📁 Categoria do Discord onde criar os canais')
          .addChannelTypes(ChannelType.GuildCategory)
          .setDefaultChannels(category.target_category_id ? [category.target_category_id] : [])
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${PREFIX}catrole:${category.id}`)
          .setPlaceholder('🛡️ Cargo de suporte desta categoria')
          .setDefaultRoles(category.support_role_id ? [category.support_role_id] : [])
      ),
      new ActionRowBuilder().addComponents(
        asking
          ? [
              new ButtonBuilder()
                .setCustomId(`${PREFIX}catdelyes:${category.id}`)
                .setLabel('Confirmar remoção')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId(`${PREFIX}cat:${category.id}`)
                .setLabel('Cancelar')
                .setEmoji('↩️')
                .setStyle(ButtonStyle.Secondary),
            ]
          : [
              new ButtonBuilder()
                .setCustomId(`${PREFIX}catedit:${category.id}`)
                .setLabel('Nome e emoji')
                .setEmoji('✏️')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`${PREFIX}catdel:${category.id}`)
                .setLabel('Remover')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger),
              backButton('cats'),
            ]
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Telas de permissões, comportamento e logs
// ---------------------------------------------------------------------------

const toggleButton = (action, label, value) =>
  new ButtonBuilder()
    .setCustomId(`${PREFIX}${action}`)
    .setLabel(label)
    .setEmoji(value ? '🟢' : '🔴')
    .setStyle(value ? ButtonStyle.Success : ButtonStyle.Secondary);

function permsPayload(guild, config, notice) {
  const { permissions } = config;

  return {
    content: notice || '🛡️ **Quem atende e quem gerencia** — só você vê isto.',
    embeds: [
      baseEmbed({
        title: '🛡️ Permissões dos tickets',
        description:
          'O **atendimento** entra nos canais de ticket e pode reivindicar. A **gerência** também reabre, ' +
          'encerra e apaga. Administradores sempre passam.\n' +
          'Cada categoria pode ter um cargo próprio — estes valem para todas.',
        fields: [
          { name: 'Atendimento', value: describeRoles(permissions.staffRoleIds), inline: false },
          { name: 'Gerência', value: describeRoles(permissions.managerRoleIds), inline: false },
          {
            name: 'Usuário pode fechar o próprio ticket',
            value: permissions.allowUserSoftClose
              ? '🟢 sim — o canal continua para a equipe decidir'
              : '🔴 não — só a equipe encerra',
            inline: false,
          },
          {
            name: 'Exigir reivindicação antes de encerrar',
            value: onOff(permissions.requireClaimBeforeFinalClose),
            inline: false,
          },
        ],
        footer: `Servidor: ${guild.name}`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${PREFIX}staff`)
          .setPlaceholder('🛡️ Cargos de atendimento')
          .setMinValues(0)
          .setMaxValues(LIMITS.roleIds)
          .setDefaultRoles(permissions.staffRoleIds)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${PREFIX}managers`)
          .setPlaceholder('👑 Cargos de gerência')
          .setMinValues(0)
          .setMaxValues(LIMITS.roleIds)
          .setDefaultRoles(permissions.managerRoleIds)
      ),
      new ActionRowBuilder().addComponents(
        toggleButton('psoft', 'Usuário fecha', permissions.allowUserSoftClose),
        toggleButton('pclaim', 'Exigir claim', permissions.requireClaimBeforeFinalClose),
        backButton()
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function behaviorPayload(guild, config, notice) {
  const { behavior } = config;

  return {
    content: notice || '⚙️ **Comportamento do atendimento** — só você vê isto.',
    embeds: [
      baseEmbed({
        title: '⚙️ Comportamento dos tickets',
        fields: [
          { name: 'Limite de tickets abertos por usuário', value: `${config.maxOpenPerUser}`, inline: true },
          {
            name: 'Prazo antes de apagar o canal',
            value: `${behavior.deleteDelaySeconds}s após o encerramento`,
            inline: true,
          },
          { name: 'Transcript HTML ao encerrar', value: onOff(behavior.createTranscript), inline: true },
          { name: 'Pedir avaliação na DM', value: onOff(behavior.sendRatingDm), inline: true },
          { name: 'Mencionar o cargo de suporte', value: onOff(behavior.pingSupportRole), inline: true },
          { name: 'Permitir reabertura', value: onOff(behavior.allowReopen), inline: true },
        ],
        footer: `Servidor: ${guild.name}`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}limits`)
          .setLabel('Limites e prazos')
          .setEmoji('🔢')
          .setStyle(ButtonStyle.Primary),
        toggleButton('btranscript', 'Transcript', behavior.createTranscript),
        toggleButton('brating', 'Avaliação', behavior.sendRatingDm),
        toggleButton('bping', 'Ping suporte', behavior.pingSupportRole),
        toggleButton('breopen', 'Reabertura', behavior.allowReopen)
      ),
      new ActionRowBuilder().addComponents(backButton()),
    ],
    allowedMentions: { parse: [] },
  };
}

function logsPayload(guild, config, notice) {
  const general = getGuildConfig(guild.id)?.log_channel_id ?? null;

  return {
    content: notice || '📊 **Logs e estatísticas** — só você vê isto.',
    embeds: [
      baseEmbed({
        title: '📊 Logs dos tickets',
        description:
          'Sem canal exclusivo, os registros vão para o canal do `/setup-logs`. ' +
          'Sem nenhum dos dois, nada é registrado — inclusive os transcripts.',
        fields: [
          {
            name: 'Canal exclusivo dos tickets',
            value: config.logChannelId ? `<#${config.logChannelId}>` : 'nenhum (usando o geral)',
            inline: true,
          },
          { name: 'Canal de logs geral', value: general ? `<#${general}>` : '⚠️ nenhum', inline: true },
          {
            name: 'O que é registrado',
            value:
              '• abertura, reivindicação e fechamento, com tempos de espera e atendimento\n' +
              '• transcript completo em HTML\n' +
              '• nota e comentário da avaliação',
            inline: false,
          },
        ],
        footer: `Servidor: ${guild.name}`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}lchannel`)
          .setPlaceholder('📍 Canal exclusivo de logs dos tickets')
          .addChannelTypes(...TEXT_CHANNEL_TYPES)
          .setDefaultChannels(config.logChannelId ? [config.logChannelId] : [])
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}lgeneral`)
          .setLabel('Usar o canal de logs geral')
          .setEmoji('↩️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!config.logChannelId),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}lstats`)
          .setLabel('Ver estatísticas')
          .setEmoji('📈')
          .setStyle(ButtonStyle.Primary),
        backButton()
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Montagem e redesenho
// ---------------------------------------------------------------------------

/**
 * Payload de uma tela do painel.
 * @param {import('discord.js').Guild} guild
 * @param {import('../utils/tickets/config').TicketConfig} config
 * @param {string} [view] tela pedida; `cat:<id>` abre a tela de uma categoria
 * @param {string} [notice] linha de retorno da última ação
 */
function buildPanelPayload(guild, config, view = 'home', notice = '') {
  const [name, arg, extra] = String(view).split(':');
  const categories = stmts.list.all(guild.id);

  if (name === 'cat') {
    const category = stmts.byId.get(Number(arg), guild.id);
    // Categoria removida por outra pessoa enquanto o painel estava aberto: a
    // lista é o destino certo, e o aviso explica o desvio.
    if (!category) {
      return catsPayload(guild, config, categories, '⚠️ Essa categoria não existe mais.');
    }
    return catPayload(guild, category, notice, extra === 'ask');
  }

  if (name === 'panel') return panelPayload(guild, config, notice);
  if (name === 'cats') return catsPayload(guild, config, categories, notice);
  if (name === 'perms') return permsPayload(guild, config, notice);
  if (name === 'behavior') return behaviorPayload(guild, config, notice);
  if (name === 'logs') return logsPayload(guild, config, notice);

  return {
    content: notice || `${emoji(guild, 'ticket')} **Painel de tickets** — só você vê isto.`,
    embeds: [homeEmbed(guild, config, categories)],
    components: homeComponents(config),
    allowedMentions: { parse: [] },
  };
}

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
        .setLabel('Emoji do botão (vazio usa o do /config-emojis)')
        .setPlaceholder('🎫 ou <:nome:123456789012345678>')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(64)
        .setRequired(false)
        .setValue(panel.buttonEmoji ?? ''),
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
    if (stmts.list.all(interaction.guild.id).length >= MAX_CATEGORIES) {
      return showView(interaction, config, 'cats', `⚠️ Limite de ${MAX_CATEGORIES} categorias atingido.`);
    }
    const { lastInsertRowid } = stmts.insert.run(interaction.guild.id, label, categoryEmoji, null, null);
    // Abre direto a tela da nova categoria: canal e cargo ainda faltam, e é lá
    // que eles são escolhidos.
    return showView(interaction, config, `cat:${lastInsertRowid}`, `➕ **${label}** criada${suffix}. Defina a categoria e o cargo.`);
  }

  const result = stmts.updateMeta.run(label, categoryEmoji, Number(arg), interaction.guild.id);
  if (!result.changes) return showView(interaction, config, 'cats', '⚠️ Essa categoria não existe mais.');
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
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Apenas administradores podem alterar o sistema de tickets.')],
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
      return openCategoryModal(interaction, stmts.byId.get(Number(arg), guildId));
    case 'modal-cat':
      return submitCategory(interaction, config, arg);
    case 'catparent': {
      const channel = interaction.channels.first();
      if (!channel) return undefined;
      stmts.updateParent.run(channel.id, Number(arg), guildId);
      return showView(interaction, config, `cat:${arg}`, `📁 Canais desta categoria serão criados em **${channel.name}**.`);
    }
    case 'catrole': {
      const role = interaction.roles.first();
      if (!role) return undefined;
      if (role.id === interaction.guild.id) {
        return showView(interaction, config, `cat:${arg}`, '⚠️ O `@everyone` não serve como cargo de suporte.');
      }
      stmts.updateRole.run(role.id, Number(arg), guildId);
      return showView(interaction, config, `cat:${arg}`, `🛡️ Cargo de suporte definido para ${role}.`);
    }
    case 'catdel':
      return showView(interaction, config, `cat:${arg}:ask`);
    case 'catdelyes': {
      const category = stmts.byId.get(Number(arg), guildId);
      stmts.remove.run(Number(arg), guildId);
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
