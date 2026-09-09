/**
 * Painel interativo do /automod.
 *
 * Três telas — início, regra, isenções — todas dentro do limite de 5 linhas de
 * componentes do Discord. Cada alteração é gravada na hora, como no
 * /setup-welcome: não existe botão "salvar".
 *
 * O estado (qual regra está aberta) vive no `customId`, no formato
 * `amod_acao:chave`. Guardar isso num Map em memória quebraria o painel a cada
 * reinício do bot, e o `customId` já é carregado de volta pelo Discord de graça.
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
const ms = require('ms');

const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { TEXT_CHANNEL_TYPES } = require('../utils/channelPerms');
const { formatDuration } = require('../utils/time');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');
const { RULES, RULE_KEYS, FAMILIES, ACTIONS, NOTIFY_MODES, NOTICE_TTL_CHOICES } = require('../config/automodRules');
const {
  MAX_POINTS,
  MAX_MUTE_MS,
  getAutomodConfig,
  updateRule,
  updateConfig,
  normalizeBool,
  normalizeList,
  exemptionReason,
} = require('../utils/automod/config');

const PREFIX = 'amod_';

/** Para consultar só as isenções globais, sem as de nenhuma regra específica. */
const EMPTY_EXEMPTIONS = Object.freeze({ exemptRoleIds: [], exemptChannelIds: [] });

/** Acka tolerando token morto/duplicado. */
const safeAck = makeSafeAck('automod-setup');

/** `amod_action:caps` -> { action: 'action', key: 'caps' } */
function parseId(customId) {
  const [action, key = ''] = customId.slice(PREFIX.length).split(':');
  return { action, key };
}

const ruleTitle = (key) => `${RULES[key].emoji} ${RULES[key].label}`;

/** Regra ligada mas sem apagar, sem ação e sem pontos: não faz nada. */
const isInert = (rule) => rule.enabled && !rule.deleteMessage && rule.action === 'none' && rule.points === 0;

/**
 * Por que esta regra ligada não vai agir, ou null se ela age.
 *
 * Três formas de uma regra ficar verde no painel e não fazer nada: não vigiar
 * canal nenhum, não ter categoria de mídia marcada, ou não apagar/punir/pontuar.
 * O admin não tem como adivinhar nenhuma das três olhando o "🟢 Ligado".
 */
function idleReason(key, rule) {
  if (!rule.enabled) return null;
  if (RULES[key].watchlist && !rule.watchChannelIds.length) return 'nenhum canal vigiado';
  if (key === 'media' && MEDIA_KINDS.every((kind) => !rule.limits[kind])) return 'nenhuma categoria marcada';
  if (isInert(rule)) return 'não apaga, não pune e não dá pontos';
  return null;
}

/** O que fazer a respeito de cada motivo, na tela da regra. */
const IDLE_FIX = Object.freeze({
  'nenhum canal vigiado':
    'Ela vale **só** nos canais vigiados e nenhum foi escolhido. Abra *Canais vigiados* e escolha ao menos um.',
  'nenhuma categoria marcada':
    'Não barra imagem, gif, vídeo, arquivo nem figurinha. Marque ao menos uma em *Limites…*.',
  'não apaga, não pune e não dá pontos': 'Escolha uma ação, ligue o *Apagar* ou dê pontos.',
});

// ---------------------------------------------------------------- tela: início

function homeEmbed(config, guild) {
  const enabledKeys = RULE_KEYS.filter((key) => config.rules[key].enabled);
  const idle = enabledKeys
    .map((key) => ({ key, reason: idleReason(key, config.rules[key]) }))
    .filter((item) => item.reason);

  const byFamily = Object.entries(FAMILIES).map(([family, meta]) => {
    const keys = RULE_KEYS.filter((key) => RULES[key].family === family);
    const on = keys.filter((key) => config.rules[key].enabled);
    return {
      name: `${meta.emoji} ${meta.label}`,
      value: on.length ? on.map((key) => `✅ ${RULES[key].label}`).join('\n') : `— ${keys.length} desligadas`,
      inline: true,
    };
  });

  const ladder = config.ladder.length
    ? config.ladder
        .map((step) => {
          const suffix = step.action === 'mute' ? ` (${formatDuration(step.muteMs)})` : '';
          return `**${step.points}** pts → ${ACTIONS[step.action].label}${suffix}`;
        })
        .join('\n')
    : 'nenhum degrau';

  const fields = [
    { name: 'Status', value: config.enabled ? '🟢 Ativado' : '🔴 Desativado', inline: true },
    { name: 'Filtros ligados', value: `${enabledKeys.length} de ${RULE_KEYS.length}`, inline: true },
    {
      name: 'Canal de logs',
      value: config.logChannelId ? `<#${config.logChannelId}>` : 'o canal de logs geral',
      inline: true,
    },
    { name: `Escada (pontos vencem em ${formatDuration(config.pointsExpireHours * 3600_000)})`, value: ladder, inline: false },
    ...byFamily,
    {
      name: 'Isenções globais',
      value: [
        config.exemptModerators ? '✅ moderadores' : '❌ moderadores **não** isentos',
        config.exemptRoleIds.length ? `${config.exemptRoleIds.length} cargo(s)` : 'nenhum cargo',
        config.exemptChannelIds.length ? `${config.exemptChannelIds.length} canal(is)` : 'nenhum canal',
      ].join(' · '),
      inline: false,
    },
  ];

  if (idle.length) {
    fields.push({
      name: '⚠️ Ligadas mas sem efeito',
      value: idle.map((item) => `**${RULES[item.key].label}** — ${item.reason}`).join('\n').slice(0, 1024),
      inline: false,
    });
  }

  return baseEmbed({
    title: '🛡️ AutoMod',
    description: config.enabled
      ? 'Escolha um filtro no menu para configurar. Tudo é salvo na hora.'
      : '**O AutoMod está desligado.** Configure os filtros e depois use *Ligar o AutoMod*.',
    color: config.enabled ? undefined : 0x95a5a6,
    fields,
    footer: `Servidor: ${guild.name}`,
  });
}

function homeComponents(config) {
  const pickRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}pick`)
      .setPlaceholder('🔧 Escolha um filtro para configurar')
      .addOptions(
        RULE_KEYS.map((key) => ({
          label: `${config.rules[key].enabled ? '✅' : '▫️'} ${RULES[key].label}`.slice(0, 100),
          value: key,
          emoji: RULES[key].emoji,
          description: `${FAMILIES[RULES[key].family].label} · ${RULES[key].description}`.slice(0, 100),
        }))
      )
  );

  const logRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${PREFIX}logchannel`)
      .setPlaceholder('📋 Canal de logs do AutoMod (opcional)')
      .addChannelTypes(...TEXT_CHANNEL_TYPES)
      .setDefaultChannels(config.logChannelId ? [config.logChannelId] : [])
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}toggleall`)
      .setLabel(config.enabled ? 'Desligar o AutoMod' : 'Ligar o AutoMod')
      .setEmoji(config.enabled ? '🔴' : '🟢')
      .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}exempt:`)
      .setLabel('Isenções globais')
      .setEmoji('🪪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}ladder`).setLabel('Escada').setEmoji('🪜').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}mods`)
      .setLabel(config.exemptModerators ? 'Isentar mods: sim' : 'Isentar mods: não')
      .setEmoji('🛠️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  return [pickRow, logRow, actionRow];
}

/**
 * Aviso de que quem está lendo o painel não seria filtrado.
 *
 * É a explicação mais comum para "configurei tudo e nada aconteceu": a isenção de
 * moderador vem ligada, e quem abre o /automod quase sempre é moderador. Sem
 * dizer isso na cara, o admin testa com a própria conta e conclui que o AutoMod
 * está quebrado.
 */
function viewerWarning(config, viewer, channelId) {
  const reason = viewer ? exemptionReason(config, EMPTY_EXEMPTIONS, viewer, channelId) : null;
  if (!reason) return '';

  const fix =
    reason === 'moderador'
      ? 'Teste com outra conta ou use *Isentar mods: não*.'
      : 'Tire a isenção ou teste em outro canal / com outra conta.';

  return `⚠️ **Você está isento (${reason}):** nada que você mandar será filtrado. ${fix}`;
}

function homePayload(config, guild, notice = '', viewer = null, channelId = null) {
  const header = '🛡️ **Painel do AutoMod** — só você vê isto.';
  const lines = [header, notice, viewerWarning(config, viewer, channelId)].filter(Boolean);

  return {
    content: lines.join('\n'),
    embeds: [homeEmbed(config, guild)],
    components: homeComponents(config),
    allowedMentions: { parse: [] },
  };
}

/** Atalho: o painel sempre pergunta pelas isenções globais, sem as de regra. */
const homeFor = (interaction, config, notice = '') =>
  homePayload(config, interaction.guild, notice, interaction.member, interaction.channelId);

// ----------------------------------------------------------------- tela: regra

/** Categorias da regra de mídia, na ordem do catálogo. */
const MEDIA_KINDS = Object.freeze(Object.keys(RULES.media.fields));

/** Prazo do aviso em texto legível. `0` é "fica", não "zero segundos". */
const describeNoticeTtl = (ms) => (ms > 0 ? `⏱️ apaga em ${formatDuration(ms)}` : '📌 até alguém apagar');

/**
 * Rótulo curto do prazo, para o placeholder do select.
 *
 * Cai no `formatDuration` quando o valor salvo não é uma das opções — config de
 * uma versão anterior do catálogo não deve virar placeholder vazio.
 */
const ttlLabel = (ms) =>
  NOTICE_TTL_CHOICES.find((choice) => choice.ms === ms)?.label ?? `apaga em ${formatDuration(ms)}`;

/** Valor de um limite em texto legível. */
function describeLimit(field, value) {
  if (field.type === 'bool') return value ? 'sim' : 'não';
  if (field.type === 'list') return value.length ? `${value.length} item(ns)` : 'vazio';
  if (field.type === 'percent') return `${value}%`;
  return String(value);
}

function ruleEmbed(key, config, guild) {
  const rule = config.rules[key];
  const meta = RULES[key];
  const fields = [
    { name: 'Status', value: rule.enabled ? '🟢 Ligado' : '🔴 Desligado', inline: true },
    { name: 'Família', value: `${FAMILIES[meta.family].emoji} ${FAMILIES[meta.family].label}`, inline: true },
    {
      name: 'Apagar a mensagem',
      value: meta.family === 'raid' ? 'não se aplica' : rule.deleteMessage ? '🗑️ sim' : 'não',
      inline: true,
    },
    { name: 'Ação imediata', value: `${ACTIONS[rule.action].emoji} ${ACTIONS[rule.action].label}`, inline: true },
    { name: 'Duração do mute', value: rule.action === 'mute' ? formatDuration(rule.muteMs) : '—', inline: true },
    { name: 'Pontos', value: `${rule.points}`, inline: true },
    { name: 'Aviso', value: `${NOTIFY_MODES[rule.notify].emoji} ${NOTIFY_MODES[rule.notify].label}`, inline: true },
    {
      name: 'Aviso fica no ar',
      // Só o aviso no canal tem prazo: a DM é do usuário, o bot não a apaga.
      value: rule.notify === 'channel' ? describeNoticeTtl(rule.noticeTtlMs) : '—',
      inline: true,
    },
    {
      name: meta.watchlist ? 'Isenções (dentro dos vigiados)' : 'Isenções desta regra',
      value:
        [
          rule.exemptRoleIds.length ? `${rule.exemptRoleIds.length} cargo(s)` : null,
          rule.exemptChannelIds.length ? `${rule.exemptChannelIds.length} canal(is)` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'nenhuma (só as globais)',
      inline: true,
    },
  ];

  // Regra de alcance restrito: mostra os canais por menção, não a contagem. "2
  // canais" não responde a pergunta que o admin tem, que é *quais*.
  if (meta.watchlist) {
    fields.push({
      name: 'Canais vigiados',
      value:
        rule.watchChannelIds.map((id) => `<#${id}>`).join(' ') ||
        '**nenhum** — a regra não vale em canal algum enquanto isto estiver vazio.',
      inline: false,
    });
  }

  const limitEntries = Object.entries(meta.fields);
  if (limitEntries.length) {
    fields.push({
      name: 'Limites',
      value: limitEntries
        .map(([name, field]) => `**${field.label}:** ${describeLimit(field, rule.limits[name])}`)
        .join('\n'),
      inline: false,
    });
  }

  const listPreview = limitEntries
    .filter(([, field]) => field.type === 'list')
    .map(([name, field]) => {
      const items = rule.limits[name];
      if (!items.length) return null;
      const shown = items.slice(0, 20).join(', ');
      return `**${field.label}:** ${shown}${items.length > 20 ? ` … +${items.length - 20}` : ''}`;
    })
    .filter(Boolean);

  if (listPreview.length) fields.push({ name: 'Conteúdo das listas', value: listPreview.join('\n').slice(0, 1024) });

  const idle = idleReason(key, rule);
  if (idle) fields.push({ name: `⚠️ Sem efeito: ${idle}`, value: IDLE_FIX[idle], inline: false });

  return baseEmbed({
    title: ruleTitle(key),
    description: meta.description,
    color: rule.enabled ? undefined : 0x95a5a6,
    fields,
    footer: `Servidor: ${guild.name}`,
  });
}

function ruleComponents(key, config) {
  const rule = config.rules[key];
  const hasLimits = Object.keys(RULES[key].fields).length > 0;
  const isRaid = RULES[key].family === 'raid';

  const actionRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}action:${key}`)
      .setPlaceholder(`⚖️ Ação imediata — atual: ${ACTIONS[rule.action].label}`)
      .addOptions(
        Object.entries(ACTIONS).map(([value, meta]) => ({
          label: meta.label,
          value,
          emoji: meta.emoji,
          description: meta.description,
          default: value === rule.action,
        }))
      )
  );

  const pointsRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}points:${key}`)
      .setPlaceholder(`🎯 Pontos por violação — atual: ${rule.points}`)
      .addOptions(
        Array.from({ length: MAX_POINTS + 1 }, (_, points) => ({
          label: points === 0 ? '0 — não conta para a escada' : `${points} ponto${points > 1 ? 's' : ''}`,
          value: String(points),
          default: points === rule.points,
        }))
      )
  );

  const notifyRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}notify:${key}`)
      .setPlaceholder(`🔔 Avisar o infrator — atual: ${NOTIFY_MODES[rule.notify].label}`)
      .addOptions(
        Object.entries(NOTIFY_MODES).map(([value, meta]) => ({
          label: meta.label,
          value,
          emoji: meta.emoji,
          default: value === rule.notify,
        }))
      )
  );

  // Quinta e última linha permitida pelo Discord. Fica desabilitada quando não há
  // aviso no canal para cronometrar, em vez de sumir: some daria a impressão de
  // que a opção não existe.
  const ttlRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}ttl:${key}`)
      .setPlaceholder(
        rule.notify === 'channel'
          ? `⏱️ Aviso no canal — atual: ${ttlLabel(rule.noticeTtlMs)}`
          : '⏱️ Prazo do aviso — só vale com o aviso no canal'
      )
      .setDisabled(rule.notify !== 'channel')
      .addOptions(
        NOTICE_TTL_CHOICES.map((choice) => ({
          label: choice.label,
          value: String(choice.ms),
          emoji: choice.emoji,
          default: choice.ms === rule.noticeTtlMs,
        }))
      )
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}toggle:${key}`)
      .setLabel(rule.enabled ? 'Desligar' : 'Ligar')
      .setEmoji(rule.enabled ? '🔴' : '🟢')
      .setStyle(rule.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}delete:${key}`)
      .setLabel(rule.deleteMessage ? 'Apagar: sim' : 'Apagar: não')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary)
      // Regra de raid não avalia mensagem nenhuma: o botão só confundiria.
      .setDisabled(isRaid),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}limits:${key}`)
      .setLabel('Limites…')
      .setEmoji('📐')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasLimits),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}exempt:${key}`)
      // Numa regra de alcance restrito, escolher os canais é o passo sem o qual
      // ela não faz nada: o botão precisa anunciar isso, não esconder atrás de
      // "Isenções".
      .setLabel(RULES[key].watchlist ? 'Canais vigiados' : 'Isenções')
      .setEmoji(RULES[key].watchlist ? '👁️' : '🪪')
      .setStyle(RULES[key].watchlist && !rule.watchChannelIds.length ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}home`).setLabel('Voltar').setEmoji('◀️').setStyle(ButtonStyle.Secondary)
  );

  return [actionRow, pointsRow, notifyRow, ttlRow, buttons];
}

const rulePayload = (key, config, guild, notice = '') => ({
  content: notice || `Configurando **${RULES[key].label}**.`,
  embeds: [ruleEmbed(key, config, guild)],
  components: ruleComponents(key, config),
  allowedMentions: { parse: [] },
});

// -------------------------------------------------------------- tela: isenções

function exemptPayload(key, config, guild, notice = '') {
  const scope = key ? config.rules[key] : config;
  const watchlist = Boolean(key && RULES[key].watchlist);
  const title = key
    ? `${watchlist ? 'Canais e isenções' : 'Isenções'} de ${RULES[key].label}`
    : 'Isenções globais';

  const rolesRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(`${PREFIX}exroles:${key}`)
      .setPlaceholder('🪪 Cargos isentos')
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultRoles(scope.exemptRoleIds)
  );

  const channelsRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${PREFIX}exchannels:${key}`)
      .setPlaceholder('📵 Canais e categorias isentos')
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultChannels(scope.exemptChannelIds)
  );

  const watchRow = !watchlist ? null : new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${PREFIX}wchannels:${key}`)
      .setPlaceholder('👁️ Canais e categorias onde a regra vale')
      .addChannelTypes(...TEXT_CHANNEL_TYPES)
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultChannels(scope.watchChannelIds ?? [])
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(key ? `${PREFIX}rule:${key}` : `${PREFIX}home`)
      .setLabel('Voltar')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  const fields = [];

  if (watchlist) {
    fields.push({
      name: '👁️ Canais vigiados',
      value:
        scope.watchChannelIds.map((id) => `<#${id}>`).join(' ') ||
        '**nenhum** — enquanto estiver vazio, a regra não vale em canal algum.',
      inline: false,
    });
  }

  fields.push(
    { name: 'Cargos isentos', value: scope.exemptRoleIds.map((id) => `<@&${id}>`).join(' ') || 'nenhum', inline: false },
    { name: 'Canais isentos', value: scope.exemptChannelIds.map((id) => `<#${id}>`).join(' ') || 'nenhum', inline: false }
  );

  const description = [
    watchlist
      ? 'Esta regra vale **só** nos canais vigiados — em todo o resto do servidor ela nem é consultada.'
      : 'Quem tem cargo isento ou fala em canal isento não é filtrado.',
    'Escolher uma **categoria** alcança os canais dela; escolher um canal alcança os tópicos dele.',
    watchlist ? 'As isenções abaixo abrem exceções **dentro** dos canais vigiados (um cargo de staff, por exemplo).' : null,
    key ? '\nEstas isenções somam com as globais.' : '\nValem para **todas** as regras.',
  ].filter(Boolean);

  return {
    content:
      notice ||
      (watchlist
        ? `👁️ **${title}** — escolha onde a regra vale; desmarque para deixar de vigiar.`
        : `🪪 **${title}** — selecione para isentar, desmarque para voltar a valer.`),
    embeds: [
      baseEmbed({ title, description: description.join('\n'), fields, footer: `Servidor: ${guild.name}` }),
    ],
    components: watchlist ? [watchRow, rolesRow, channelsRow, buttons] : [rolesRow, channelsRow, buttons],
    allowedMentions: { parse: [] },
  };
}

// ------------------------------------------------------------------- modais

/** Modal dos limites da regra. Os campos vêm do catálogo, no máximo 5. */
function showLimitsModal(interaction, key, config) {
  const rule = config.rules[key];
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}mlimits:${key}`)
    .setTitle(`Limites — ${RULES[key].label}`.slice(0, 45));

  const inputs = Object.entries(RULES[key].fields).map(([name, field]) => {
    const current = rule.limits[name];
    const isList = field.type === 'list';

    const label = field.type === 'bool' ? `${field.label} (sim/não)` : field.label;
    const input = new TextInputBuilder()
      .setCustomId(name)
      .setLabel(label.slice(0, 45))
      .setStyle(isList ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(false)
      .setValue(isList ? current.join('\n') : describeLimit(field, current));

    if (field.hint) input.setPlaceholder(field.hint.slice(0, 100));
    if (isList) input.setMaxLength(4000);
    else input.setMaxLength(20);

    return new ActionRowBuilder().addComponents(input);
  });

  modal.addComponents(...inputs);
  return interaction.showModal(modal).catch(swallowAckFailure('automod-setup', interaction));
}

/** Modal da duração do mute da regra. */
function showMuteModal(interaction, key, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}mmute:${key}`).setTitle('Duração do silenciamento');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('duration')
        .setLabel('Duração (ex.: 10m, 1h, 2d) — máx 28d')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(10)
        .setRequired(true)
        .setValue(formatDuration(config.rules[key].muteMs).replace(/\s+/g, ''))
    )
  );

  return interaction.showModal(modal).catch(swallowAckFailure('automod-setup', interaction));
}

/** Modal da escada, uma linha por degrau. */
function showLadderModal(interaction, config) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}mladder`).setTitle('Escada de punição');

  const current = config.ladder
    .map((step) => `${step.points} ${step.action}${step.action === 'mute' ? ` ${formatDuration(step.muteMs).replace(/\s+/g, '')}` : ''}`)
    .join('\n');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('steps')
        .setLabel('Um degrau por linha')
        .setPlaceholder('3 mute 10m\n5 mute 1h\n8 kick\n12 ban')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(current)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('expire')
        .setLabel('Pontos vencem em (ex.: 7d, 12h)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(10)
        .setRequired(true)
        .setValue(`${config.pointsExpireHours}h`)
    )
  );

  return interaction.showModal(modal).catch(swallowAckFailure('automod-setup', interaction));
}

/**
 * Lê uma duração escrita por humano: `10m`, `1h`, `2d3h`, ou um número solto
 * (interpretado como minutos). Soma as partes porque o próprio painel escreve
 * "2d 3h" no campo, e `ms()` só entende uma unidade por vez.
 *
 * @returns {number|null} milissegundos, ou null quando não dá para entender
 */
function parseDuration(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) * 60_000;

  const parts = [...text.matchAll(/(\d+)\s*(ms|s|m|h|d|w)/g)];
  if (!parts.length) return null;

  const total = parts.reduce((sum, [, amount, unit]) => sum + (ms(`${amount}${unit}`) ?? 0), 0);
  return total > 0 ? total : null;
}

/** "3 mute 10m" -> degrau. null se a linha não faz sentido. */
function parseLadderLine(line) {
  const [pointsRaw, actionRaw, durationRaw] = line.trim().split(/\s+/);
  const points = Number.parseInt(pointsRaw, 10);
  const action = String(actionRaw ?? '').toLowerCase();

  if (!Number.isFinite(points) || points < 1) return null;
  if (!Object.hasOwn(ACTIONS, action) || action === 'none') return null;

  return { points, action, muteMs: parseDuration(durationRaw) ?? 10 * 60_000 };
}

// ------------------------------------------------------------------- ações

function saveRule(interaction, key, changes, notice) {
  const config = updateRule(interaction.guild.id, key, changes);
  return safeAck(interaction, () => interaction.update(rulePayload(key, config, interaction.guild, notice)));
}

function saveGlobal(interaction, changes, notice) {
  const config = updateConfig(interaction.guild.id, changes);
  return safeAck(interaction, () => interaction.update(homeFor(interaction, config, notice)));
}

function handleLimitsSubmit(interaction, key, config) {
  const fields = RULES[key].fields;
  const rejected = [];

  const limits = Object.fromEntries(
    Object.entries(fields).map(([name, field]) => {
      const raw = interaction.fields.getTextInputValue(name).trim();
      const current = config.rules[key].limits[name];

      if (field.type === 'list') return [name, normalizeList(raw)];
      if (field.type === 'bool') return [name, normalizeBool(raw, current)];

      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < field.min || value > field.max) {
        // Fora da faixa não é silenciosamente ajustado: o admin precisa saber que
        // o número dele não valeu, senão configura "1000" e confia.
        rejected.push(`${field.label} (aceita ${field.min}–${field.max})`);
        return [name, current];
      }
      return [name, value];
    })
  );

  const notice = rejected.length
    ? `⚠️ Mantive o valor anterior de: ${rejected.join(', ')}.`
    : '📐 Limites atualizados.';

  return saveRule(interaction, key, { limits }, notice);
}

function handleMuteSubmit(interaction, key) {
  const parsed = parseDuration(interaction.fields.getTextInputValue('duration'));
  if (!parsed) {
    const config = getAutomodConfig(interaction.guild.id);
    return safeAck(interaction, () =>
      interaction.update(rulePayload(key, config, interaction.guild, '⚠️ Não entendi a duração. Use algo como `10m`, `1h`, `2d`.'))
    );
  }

  const muteMs = Math.min(parsed, MAX_MUTE_MS);
  const capped = parsed > MAX_MUTE_MS ? ' (o Discord limita a 28 dias)' : '';
  return saveRule(interaction, key, { muteMs }, `🔇 Mute de ${formatDuration(muteMs)}${capped}.`);
}

function handleLadderSubmit(interaction) {
  const lines = interaction.fields.getTextInputValue('steps').split(/\r?\n/).filter((line) => line.trim());
  const parsed = lines.map(parseLadderLine);
  const ladder = parsed.filter(Boolean);
  const badLines = parsed.filter((step) => !step).length;

  const expireMs = parseDuration(interaction.fields.getTextInputValue('expire'));
  const changes = { ladder };
  if (expireMs) changes.pointsExpireHours = Math.max(1, Math.round(expireMs / 3600_000));

  const notes = [];
  if (badLines) notes.push(`${badLines} linha(s) ignorada(s) — use \`pontos ação duração\``);
  if (!expireMs) notes.push('não entendi a validade dos pontos, mantive a anterior');

  return saveGlobal(
    interaction,
    changes,
    notes.length ? `⚠️ ${notes.join(' · ')}.` : `🪜 Escada com ${ladder.length} degrau(s) salva.`
  );
}

function handleExemptSelect(interaction, key, ids, kind) {
  const field = kind === 'roles' ? 'exemptRoleIds' : 'exemptChannelIds';
  const label = kind === 'roles' ? 'Cargos' : 'Canais';

  const config = key
    ? updateRule(interaction.guild.id, key, { [field]: ids })
    : updateConfig(interaction.guild.id, { [field]: ids });

  return safeAck(interaction, () =>
    interaction.update(exemptPayload(key, config, interaction.guild, `🪪 ${label} isentos: ${ids.length}.`))
  );
}

function handleWatchSelect(interaction, key, ids) {
  const config = updateRule(interaction.guild.id, key, { watchChannelIds: ids });
  const notice = ids.length
    ? `👁️ Vigiando ${ids.length} canal(is)/categoria(s).`
    : '👁️ Nenhum canal vigiado — a regra deixou de valer em qualquer lugar.';

  return safeAck(interaction, () => interaction.update(exemptPayload(key, config, interaction.guild, notice)));
}

function handleToggleAll(interaction, config) {
  const enabled = !config.enabled;
  if (enabled && !RULE_KEYS.some((key) => config.rules[key].enabled)) {
    return safeAck(interaction, () =>
      interaction.update(homeFor(interaction, config, '⚠️ Ligue pelo menos um filtro antes — assim o AutoMod não faria nada.'))
    );
  }
  return saveGlobal(interaction, { enabled }, enabled ? '🟢 AutoMod ativado.' : '🔴 AutoMod desativado.');
}

function handleLogChannel(interaction) {
  const channel = interaction.channels.first();
  return saveGlobal(
    interaction,
    { logChannelId: channel?.id ?? null },
    channel ? `📋 Logs do AutoMod em ${channel}.` : '📋 Voltou a usar o canal de logs geral.'
  );
}

const closePayload = {
  content: '',
  embeds: [successEmbed('Painel fechado. Tudo o que você mudou já está salvo.')],
  components: [],
};

/** Roteia as interações do painel (`amod_*`). */
async function routeAutomodSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Apenas administradores podem configurar o AutoMod.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const { action, key } = parseId(interaction.customId);
  const config = getAutomodConfig(interaction.guild.id);

  // Regra que saiu do catálogo (config antiga, painel velho aberto): volta ao início
  // em vez de estourar num acesso a RULES[key].
  if (key && !Object.hasOwn(RULES, key)) {
    return safeAck(interaction, () =>
      interaction.update(homeFor(interaction, config, '⚠️ Esse filtro não existe mais.'))
    );
  }

  switch (action) {
    case 'pick':
      return safeAck(interaction, () =>
        interaction.update(rulePayload(interaction.values[0], config, interaction.guild))
      );
    case 'rule':
      return safeAck(interaction, () => interaction.update(rulePayload(key, config, interaction.guild)));
    case 'home':
      return safeAck(interaction, () => interaction.update(homeFor(interaction, config)));

    case 'toggle': {
      const rule = config.rules[key];
      const enabled = !rule.enabled;
      const idle = enabled ? idleReason(key, { ...rule, enabled }) : null;
      const warning = idle ? ` ⚠️ Mas: ${idle}.` : '';
      return saveRule(interaction, key, { enabled }, `${enabled ? '🟢 Ligado' : '🔴 Desligado'}: ${RULES[key].label}.${warning}`);
    }
    case 'delete':
      return saveRule(
        interaction,
        key,
        { deleteMessage: !config.rules[key].deleteMessage },
        config.rules[key].deleteMessage ? '📝 A mensagem não será mais apagada.' : '🗑️ A mensagem será apagada.'
      );
    case 'action': {
      const chosen = interaction.values[0];
      // Mute precisa de duração: abre o modal em vez de assumir um número.
      if (chosen === 'mute') {
        updateRule(interaction.guild.id, key, { action: 'mute' });
        return showMuteModal(interaction, key, config);
      }
      return saveRule(interaction, key, { action: chosen }, `⚖️ Ação: ${ACTIONS[chosen].label}.`);
    }
    case 'points':
      return saveRule(interaction, key, { points: Number(interaction.values[0]) }, `🎯 ${interaction.values[0]} ponto(s) por violação.`);
    case 'notify':
      return saveRule(interaction, key, { notify: interaction.values[0] }, `🔔 Aviso: ${NOTIFY_MODES[interaction.values[0]].label}.`);
    case 'ttl': {
      const ms = Number(interaction.values[0]);
      return saveRule(
        interaction,
        key,
        { noticeTtlMs: ms },
        ms > 0
          ? `⏱️ O aviso no canal se apaga em ${formatDuration(ms)}.`
          : '📌 O aviso no canal fica no ar até alguém apagar.'
      );
    }
    case 'limits':
      return showLimitsModal(interaction, key, config);
    case 'mlimits':
      return handleLimitsSubmit(interaction, key, config);
    case 'mmute':
      return handleMuteSubmit(interaction, key);

    case 'exempt':
      return safeAck(interaction, () => interaction.update(exemptPayload(key, config, interaction.guild)));
    case 'exroles':
      return handleExemptSelect(interaction, key, interaction.values, 'roles');
    case 'exchannels':
      return handleExemptSelect(interaction, key, interaction.values, 'channels');
    case 'wchannels':
      return handleWatchSelect(interaction, key, interaction.values);

    case 'ladder':
      return showLadderModal(interaction, config);
    case 'mladder':
      return handleLadderSubmit(interaction);
    case 'mods':
      return saveGlobal(
        interaction,
        { exemptModerators: !config.exemptModerators },
        config.exemptModerators ? '🛠️ Moderadores agora **também** são filtrados.' : '🛠️ Moderadores estão isentos.'
      );
    case 'logchannel':
      return handleLogChannel(interaction);
    case 'toggleall':
      return handleToggleAll(interaction, config);
    case 'close':
      return safeAck(interaction, () => interaction.update(closePayload));
    default:
      return undefined;
  }
}

module.exports = {
  PREFIX,
  homePayload,
  homeFor,
  rulePayload,
  parseDuration,
  parseLadderLine,
  isInert,
  idleReason,
  routeAutomodSetup,
};
