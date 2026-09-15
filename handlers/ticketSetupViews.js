/**
 * Telas do painel `/ticket-config`.
 *
 * Só desenho: cada função recebe `guild` + config (+ categorias) e devolve o
 * payload da tela. Nada aqui grava — as ações moram no `ticketSetupHandler`.
 *
 * A tela em edição viaja no `customId` (`tsetup_<ação>:<arg>`), então o payload é
 * sempre reconstruído do banco a cada clique: um painel aberto ontem continua
 * respondendo hoje.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const { getGuildConfig } = require('../database/db');
const { baseEmbed } = require('../utils/embeds');
const { describeColor, colorSelectOptions } = require('../utils/colors');
const { emoji } = require('../utils/emojis');
const { POST_EMBED_PERMS_LABEL, TEXT_CHANNEL_TYPES, canPostEmbed } = require('../utils/channelPerms');
const { LIMITS } = require('../utils/tickets/config');
const { buildTicketPanel } = require('../utils/tickets/panel');
const { ticketConfigWarnings } = require('../utils/tickets/diagnostics');
const { listCategories, getCategory } = require('../utils/tickets/categories');

const PREFIX = 'tsetup_';

/** Telas do painel. É o único estado da navegação. */
const VIEWS = Object.freeze(['home', 'panel', 'cats', 'perms', 'behavior', 'logs']);

/** Teto do select de categorias do painel público. */
const MAX_CATEGORIES = 25;

/** Valor do select de cor que abre o modal de hex livre (igual ao /setup-verify). */
const HEX_OPTION = 'hexlivre';

const onOff = (value) => (value ? '🟢 sim' : '🔴 não');

// ---------------------------------------------------------------------------
// Tela inicial
// ---------------------------------------------------------------------------

const describeRoles = (ids) => (ids.length ? ids.map((id) => `<@&${id}>`).join(' ') : 'nenhum');

function homeEmbed(guild, config, categories) {
  const warnings = ticketConfigWarnings(guild, config, categories);
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
// Montagem
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
  const categories = listCategories(guild.id);

  if (name === 'cat') {
    const category = getCategory(arg, guild.id);
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

module.exports = { PREFIX, VIEWS, MAX_CATEGORIES, HEX_OPTION, buildPanelPayload };
