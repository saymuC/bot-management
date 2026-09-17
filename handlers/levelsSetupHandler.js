/**
 * Painel interativo do /levelconfig.
 *
 * Mesmo padrão dos painéis já existentes (`wsetup_`, `amod_`): componentes com um
 * prefixo próprio, `makeSafeAck` para o token de 3s, e **nenhum botão salvar** —
 * cada alteração é gravada na hora e o painel é sempre reconstruído a partir do
 * banco. Não existe sessão em memória, então dois admins mexendo ao mesmo tempo
 * veem o estado real em vez de rascunhos divergentes.
 *
 * Também roteia a confirmação do `/reset-xp`, que exige a mesma permissão e o
 * mesmo tratamento de ack.
 */

const {
  ActionRowBuilder,
  AttachmentBuilder,
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
const { TEXT_CHANNEL_TYPES } = require('../utils/channelPerms');
const { makeSafeAck, swallowAckFailure } = require('../utils/interactionAck');
const {
  LIMITS,
  REWARD_MODES,
  MAX_BACKGROUND_BYTES,
  THEME_PRESETS,
  ACCENT_COLORS,
  CORNER_STYLES,
  THEME_TOGGLES,
  DEFAULT_THEME,
} = require('../config/levels');
const { fetchRemoteImage } = require('../utils/remoteImage');
const { checkCanvasFonts } = require('../utils/canvasFonts');
const { MAX_LEVEL } = require('../utils/levels/formula');
const { getLevelsConfig, saveLevelsConfig, normalizeIds, normalizeHexColor } = require('../utils/levels/config');
const { renderAppearancePreview } = require('../utils/levels/card/preview');
const { roleBlockReason, syncMemberRewards } = require('../utils/levels/rewards');
const { validateAssignableRole } = require('../utils/assignableRoles');
const { resetUserXp } = require('../utils/levels/service');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');

const PREFIX = 'lvl_';

const safeAck = makeSafeAck('levels-setup');

/** Telas do painel. O `view` é o que a navegação guarda; não há estado além dele. */
const VIEWS = Object.freeze(['home', 'announce', 'exclusions', 'rewards', 'appearance']);

// ---------------------------------------------------------------------------
// Diagnóstico: configuração ligada que não faz nada
// ---------------------------------------------------------------------------

/**
 * Avisos sobre config inerte ou quebrada.
 *
 * Um painel que só mostra os valores salvos deixa o admin achando que ligou algo
 * que na prática está parado — recompensa apontando para cargo apagado, canal de
 * anúncio que não existe mais, sistema ligado sem nada configurado. Estes avisos
 * são a diferença entre "está tudo certo" e "está tudo salvo".
 *
 * @param {import('../utils/levels/types').LevelsConfig} config
 * @param {import('discord.js').Guild} guild
 * @returns {string[]}
 */
function idleWarnings(config, guild) {
  const warnings = [];

  if (!config.enabled) warnings.push('o sistema está **desligado**: nada abaixo tem efeito ainda.');

  if (config.announceEnabled && config.announceChannelId) {
    const channel = guild.channels.cache.get(config.announceChannelId);
    if (!channel) warnings.push('o canal de anúncio não existe mais — os avisos caem no canal da mensagem.');
  }

  for (const reward of config.rewards) {
    for (const roleId of reward.roleIds) {
      const block = roleBlockReason(guild, roleId);
      if (block) warnings.push(`recompensa do nível ${reward.level}: ${block}.`);
    }
  }

  if (config.enabled && !config.rewards.length && !config.announceEnabled) {
    warnings.push('sem recompensas e sem anúncio, o XP acumula mas nada é visível fora do `/rank`.');
  }

  // Sem fonte no host o `/top` e o `/rank` saem em embed de texto, e aí o fundo
  // configurado não aparece em lugar nenhum — vale avisar antes de o admin achar
  // que a imagem dele foi ignorada.
  if ((config.backgroundUrl || config.headline) && !checkCanvasFonts().ok) {
    warnings.push('a aparência está configurada, mas o servidor do bot não tem fonte instalada: o ranking sai em texto.');
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Tela inicial
// ---------------------------------------------------------------------------

const describeChannel = (id) => (id ? `<#${id}>` : 'canal da mensagem');

function homeEmbed(config, guild) {
  const warnings = idleWarnings(config, guild);
  const rewardSummary = config.rewards.length
    ? config.rewards.map((r) => `N${r.level}×${r.roleIds.length}`).join(' · ')
    : 'nenhuma';

  return baseEmbed({
    title: '📈 Configuração de níveis e XP',
    description: [
      'Tudo abaixo é salvo automaticamente.',
      warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    color: config.enabled ? undefined : 0x95a5a6,
    fields: [
      { name: 'Status', value: config.enabled ? '🟢 Ativado' : '🔴 Desativado', inline: true },
      { name: 'XP por mensagem', value: `${config.xpMin} – ${config.xpMax}`, inline: true },
      { name: 'Cooldown', value: `${config.cooldownSeconds}s`, inline: true },
      {
        name: 'Anti-farm',
        value: `mín. ${config.minUsefulChars} caracteres úteis\nrepetição: ${
          config.repeatWindowSeconds ? `${config.repeatWindowSeconds}s` : 'desligada'
        }`,
        inline: true,
      },
      {
        name: 'Anúncio de level-up',
        value: config.announceEnabled ? `🔔 ${describeChannel(config.announceChannelId)}` : '🔕 desligado',
        inline: true,
      },
      {
        name: 'Exclusões',
        value: `${config.ignoredChannelIds.length} canal(is) · ${config.ignoredRoleIds.length} cargo(s)`,
        inline: true,
      },
      { name: 'Recompensas', value: rewardSummary, inline: true },
      {
        name: 'Modo de recompensa',
        value: `${REWARD_MODES[config.rewardMode].emoji} ${REWARD_MODES[config.rewardMode].label}`,
        inline: true,
      },
    ],
    footer: `Servidor: ${guild.name}`,
  });
}

function homeComponents(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}toggle`)
        .setLabel(config.enabled ? 'Desativar' : 'Ativar')
        .setEmoji(config.enabled ? '🔴' : '🟢')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}xp`)
        .setLabel('XP e cooldown')
        .setEmoji('✨')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}antifarm`)
        .setLabel('Anti-farm')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}view:announce`)
        .setLabel('Anúncios')
        .setEmoji('🔔')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}view:exclusions`)
        .setLabel('Exclusões')
        .setEmoji('🚫')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}view:rewards`)
        .setLabel('Recompensas')
        .setEmoji('🎁')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}view:appearance`)
        .setLabel('Aparência')
        .setEmoji('🎨')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

// ---------------------------------------------------------------------------
// Tela de aparência (imagem do /top e do /rank)
// ---------------------------------------------------------------------------

/**
 * Passos do véu no seletor.
 *
 * De 10 em 10 em vez de um campo numérico: a diferença entre 47% e 50% não é
 * visível, e um select resolve na mesma interação — um modal só para isso custaria
 * dois cliques a mais por ajuste, numa tela feita para ser mexida repetidamente.
 */
const VEIL_STEPS = Object.freeze([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);

/** Valor do select de accent que abre o modal em vez de gravar uma cor do catálogo. */
const ACCENT_CUSTOM = 'custom';

/**
 * A aparência descrita em linhas curtas, para o admin conferir sem contar cliques.
 *
 * @param {import('../utils/levels/types').LevelsConfig} config
 */
function appearanceSummary(config) {
  const theme = config.theme;
  const preset = THEME_PRESETS[theme.preset];
  const accent = ACCENT_COLORS[theme.accent];
  const off = THEME_TOGGLES.filter((toggle) => !theme[toggle.key]);

  return [
    `**Tema:** ${preset.emoji} ${preset.label}${theme.cardColor ? ` · papel \`${theme.cardColor}\`` : ''}`,
    `**Destaque:** ${theme.accentColor ? `🎨 \`${theme.accentColor}\`` : `${accent.emoji} ${accent.label}`}`,
    `**Cantos:** ${CORNER_STYLES[theme.corners].emoji} ${CORNER_STYLES[theme.corners].label} · **véu do fundo:** ${theme.veil}%`,
    `**Título:** ${theme.title ? `“${theme.title}”` : '_Ranking de XP_'} · **frase:** ${
      config.headline ? `“${config.headline}”` : '_nenhuma_'
    }`,
    `**Fundo:** ${config.backgroundUrl ? `[link](${config.backgroundUrl})` : '_gradiente desenhado pelo bot_'}`,
    `**Desligados:** ${off.length ? off.map((t) => `${t.emoji} ${t.label}`).join(' · ') : '_nenhum_'}`,
  ].join('\n');
}

/**
 * Os cinco controles da tela, com o estado atual já marcado.
 *
 * Cinco linhas é o teto do Discord, e é o que obriga o véu e os cantos a dividirem
 * um seletor e os seis liga/desliga a virarem um multi-select: gastar uma linha por
 * booleano não caberia, e tirar controle da tela contraria o pedido de ser completo.
 *
 * O modo do preview viaja no `customId` de tudo porque o painel não guarda estado —
 * sem isso, mexer numa cor enquanto olha o `/rank` jogaria a tela de volta no `/top`.
 *
 * @param {import('../utils/levels/types').LevelsConfig} config
 * @param {'top'|'rank'} mode
 */
function appearanceComponents(config, mode) {
  const theme = config.theme;
  const other = mode === 'rank' ? 'top' : 'rank';

  const presetOptions = Object.entries(THEME_PRESETS).map(([key, preset]) => ({
    label: preset.label,
    value: key,
    emoji: preset.emoji,
    description: preset.description,
    default: key === theme.preset,
  }));

  const accentOptions = [
    ...Object.entries(ACCENT_COLORS).map(([key, accent]) => ({
      label: accent.label,
      value: key,
      emoji: accent.emoji,
      description: accent.hex,
      default: !theme.accentColor && key === theme.accent,
    })),
    {
      label: 'Personalizada (hex)',
      value: ACCENT_CUSTOM,
      emoji: '🎨',
      description: theme.accentColor ?? 'abre o formulário de cores',
      default: Boolean(theme.accentColor),
    },
  ];

  // Duas listas num select só (cantos e véu) economiza uma linha de componente, mas
  // custa o `default`: são dois ajustes independentes num menu de escolha única, e
  // marcar os dois estoura o `maxValues` — o Discord recusa a mensagem inteira. O
  // estado atual dos dois vai no placeholder, que é lido antes de abrir a lista.
  const styleOptions = [
    ...Object.entries(CORNER_STYLES).map(([key, corner]) => ({
      label: `Cantos ${corner.label.toLowerCase()}`,
      value: `corner-${key}`,
      emoji: corner.emoji,
      description: key === theme.corners ? 'em uso agora' : undefined,
    })),
    ...VEIL_STEPS.map((step) => ({
      label: `Véu do fundo ${step}%`,
      value: `veil-${step}`,
      emoji: '🌫️',
      description:
        step === theme.veil ? 'em uso agora' : step === 0 ? 'fundo sem escurecer' : undefined,
    })),
  ];

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}ap-preset:${mode}`)
        .setPlaceholder('🎨 Tema das cores')
        .addOptions(presetOptions)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}ap-accent:${mode}`)
        .setPlaceholder('✨ Cor de destaque (barra e faixas)')
        .addOptions(accentOptions)
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}ap-toggles:${mode}`)
        .setPlaceholder('👁️ Elementos visíveis')
        .setMinValues(0)
        .setMaxValues(THEME_TOGGLES.length)
        .addOptions(
          THEME_TOGGLES.map((toggle) => ({
            label: toggle.label,
            value: toggle.key,
            emoji: toggle.emoji,
            description: toggle.description,
            default: Boolean(theme[toggle.key]),
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}ap-style:${mode}`)
        .setPlaceholder(`🔲 Cantos e véu — hoje: ${CORNER_STYLES[theme.corners].label.toLowerCase()}, ${theme.veil}%`)
        .addOptions(styleOptions)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}ap-edit:${mode}`)
        .setLabel('Textos e imagem')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}ap-mode:${other}`)
        .setLabel(other === 'rank' ? 'Ver /rank' : 'Ver /top')
        .setEmoji('🔁')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}ap-reset:${mode}`)
        .setLabel('Voltar ao padrão')
        .setEmoji('♻️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}view:home`).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

/**
 * Tela de aparência, com o preview anexado quando existe.
 *
 * @param {import('../utils/levels/types').LevelsConfig} config
 * @param {import('discord.js').Guild} guild
 * @param {string} notice
 * @param {{ image: Buffer|null, demo: boolean, signature: string }|null} preview
 * @param {'top'|'rank'} mode
 */
function appearancePayload(config, guild, notice, preview = null, mode = 'top') {
  const fonts = checkCanvasFonts();

  const embed = baseEmbed({
    title: '🎨 Aparência do ranking',
    description: [
      `Tudo aqui vale para o \`/top\` e para o \`/rank\`, e é salvo na hora. A imagem abaixo é a prévia do **/${mode}** com as escolhas atuais.`,
      '',
      appearanceSummary(config),
      '',
      preview?.demo
        ? '_A prévia completa o ranking com participantes de exemplo — o servidor ainda não tem gente suficiente._'
        : '',
      preview && !preview.image ? '⚠️ Não foi possível desenhar a prévia agora; os ajustes continuam sendo salvos.' : '',
      fonts.ok ? '' : `⚠️ ${fonts.reason}`,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: `Título: até ${LIMITS.titleChars} caracteres · frase: até ${LIMITS.headlineChars} · a cor do texto é escolhida automaticamente para contrastar com o papel`,
  });

  return {
    content: notice || '',
    embeds: [embed],
    components: appearanceComponents(config, mode),
    // O nome carrega a assinatura do tema: o cliente do Discord guarda anexo por
    // nome e, com nome fixo, reexibiria a prévia anterior a cada ajuste.
    files: preview?.image ? [new AttachmentBuilder(preview.image, { name: `preview-${mode}-${previewTag(preview)}.png` })] : [],
    attachments: [],
    allowedMentions: { parse: [] },
  };
}

/** Sufixo curto e estável do nome do arquivo, derivado da assinatura do visual. */
function previewTag(preview) {
  let hash = 0;
  for (const char of preview.signature) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff;
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// Tela de anúncios
// ---------------------------------------------------------------------------

function announcePayload(config, guild, notice) {
  const embed = baseEmbed({
    title: '🔔 Anúncio de level-up',
    description: [
      'Uma única mensagem por subida, mesmo quando o membro pula vários níveis.',
      '',
      `**Status:** ${config.announceEnabled ? '🔔 ligado' : '🔕 desligado'}`,
      `**Canal:** ${describeChannel(config.announceChannelId)}`,
      '',
      'Sem canal fixo, o aviso sai onde o membro estava conversando. Se o canal fixo for apagado ou o bot perder acesso, o aviso cai nesse mesmo lugar.',
    ].join('\n'),
    color: config.announceEnabled ? undefined : 0x95a5a6,
  });

  return {
    content: notice || '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}ann-channel`)
          .setPlaceholder('📍 Canal fixo dos anúncios')
          .addChannelTypes(...TEXT_CHANNEL_TYPES)
          .setDefaultChannels(config.announceChannelId ? [config.announceChannelId] : [])
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}ann-toggle`)
          .setLabel(config.announceEnabled ? 'Desligar anúncio' : 'Ligar anúncio')
          .setEmoji(config.announceEnabled ? '🔕' : '🔔')
          .setStyle(config.announceEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}ann-current`)
          .setLabel('Usar o canal da mensagem')
          .setEmoji('💬')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!config.announceChannelId),
        new ButtonBuilder().setCustomId(`${PREFIX}view:home`).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Tela de exclusões
// ---------------------------------------------------------------------------

function exclusionsPayload(config, guild, notice) {
  const list = (ids, render) => (ids.length ? ids.map(render).join(' ') : '_nenhum_');

  const embed = baseEmbed({
    title: '🚫 Canais e cargos fora do sistema',
    description: [
      'Mensagens nos canais listados não valem XP. Membros com algum dos cargos listados não recebem XP em nenhum canal.',
      '',
      `**Canais (${config.ignoredChannelIds.length}/${LIMITS.ignoredChannels}):** ${list(
        config.ignoredChannelIds,
        (id) => `<#${id}>`
      )}`,
      `**Cargos (${config.ignoredRoleIds.length}/${LIMITS.ignoredRoles}):** ${list(
        config.ignoredRoleIds,
        (id) => `<@&${id}>`
      )}`,
      '',
      'Escolher uma **categoria** cobre os canais dela; escolher um canal cobre os tópicos dele.',
    ].join('\n'),
  });

  return {
    content: notice || '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}ex-channels`)
          .setPlaceholder('🚫 Canais sem XP')
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultChannels(config.ignoredChannelIds.slice(0, 25))
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${PREFIX}ex-roles`)
          .setPlaceholder('🚫 Cargos sem XP')
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultRoles(config.ignoredRoleIds.slice(0, 25))
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}ex-clear`)
          .setLabel('Limpar tudo')
          .setEmoji('♻️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!config.ignoredChannelIds.length && !config.ignoredRoleIds.length),
        new ButtonBuilder().setCustomId(`${PREFIX}view:home`).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Tela de recompensas
// ---------------------------------------------------------------------------

function rewardsPayload(config, guild, notice) {
  const lines = config.rewards.map((reward) => {
    const roles = reward.roleIds.map((id) => `<@&${id}>`).join(' ');
    const blocked = reward.roleIds.map((id) => roleBlockReason(guild, id)).filter(Boolean);
    return `**Nível ${reward.level}** → ${roles}${blocked.length ? ` ⚠️ ${blocked.join(' · ')}` : ''}`;
  });

  const embed = baseEmbed({
    title: '🎁 Cargos por nível',
    description: [
      lines.length ? lines.join('\n') : '_Nenhuma recompensa configurada._',
      '',
      `**Modo:** ${REWARD_MODES[config.rewardMode].emoji} ${REWARD_MODES[config.rewardMode].label} — ${
        REWARD_MODES[config.rewardMode].description
      }`,
      '',
      'Ao subir vários níveis de uma vez, todos os cargos alcançados são conciliados — não só o do nível final. Ao perder nível, os cargos que já não valem são retirados. O bot nunca remove cargo que não esteja nesta lista.',
    ].join('\n'),
    footer: `${config.rewards.length}/${LIMITS.rewards} níveis configurados`,
  });

  const components = [];

  if (config.rewards.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}rw-remove`)
          .setPlaceholder('🗑️ Remover a recompensa de um nível')
          .addOptions(
            config.rewards.slice(0, 25).map((reward) => ({
              label: `Nível ${reward.level}`,
              value: String(reward.level),
              description: `${reward.roleIds.length} cargo(s)`,
            }))
          )
      )
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}rw-add`)
        .setLabel('Adicionar / editar nível')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(config.rewards.length >= LIMITS.rewards),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}rw-mode`)
        .setLabel(`Modo: ${REWARD_MODES[config.rewardMode].label}`)
        .setEmoji(REWARD_MODES[config.rewardMode].emoji)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}view:home`).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
    )
  );

  return { content: notice || '', embeds: [embed], components, allowedMentions: { parse: [] } };
}

// ---------------------------------------------------------------------------
// Montagem e navegação
// ---------------------------------------------------------------------------

/**
 * Payload de uma tela do painel.
 * @param {import('../utils/levels/types').LevelsConfig} config
 * @param {import('discord.js').Guild} guild
 * @param {'home'|'announce'|'exclusions'|'rewards'|'appearance'} view
 * @param {string} [notice] linha de retorno da última ação
 * @param {{ image: Buffer|null, demo: boolean, signature: string }|null} [preview] prévia da aparência
 * @param {'top'|'rank'} [mode] qual imagem a prévia mostra
 */
function buildPanelPayload(config, guild, view = 'home', notice = '', preview = null, mode = 'top') {
  if (view === 'appearance') return appearancePayload(config, guild, notice, preview, mode);

  // As outras telas limpam o anexo: sem isto a prévia da aparência ficaria pendurada
  // na mensagem depois de o admin voltar para a tela inicial.
  const clean = { files: [], attachments: [] };

  if (view === 'announce') return { ...announcePayload(config, guild, notice), ...clean };
  if (view === 'exclusions') return { ...exclusionsPayload(config, guild, notice), ...clean };
  if (view === 'rewards') return { ...rewardsPayload(config, guild, notice), ...clean };

  return {
    content: notice || '🔧 **Painel de níveis** — só você vê isto.',
    embeds: [homeEmbed(config, guild)],
    components: homeComponents(config),
    allowedMentions: { parse: [] },
    ...clean,
  };
}

/** Grava a alteração e redesenha a tela atual. */
function applyChange(interaction, config, changes, notice, view = 'home') {
  const saved = saveLevelsConfig(interaction.guild.id, { ...config, ...changes });
  return safeAck(interaction, () => interaction.update(buildPanelPayload(saved, interaction.guild, view, notice)));
}

/** Redesenha sem gravar nada (navegação e avisos). */
function showView(interaction, config, view, notice = '') {
  return safeAck(interaction, () => interaction.update(buildPanelPayload(config, interaction.guild, view, notice)));
}

/**
 * Grava uma mudança de aparência e redesenha a tela **com a prévia nova**.
 *
 * `deferUpdate()` antes de desenhar, e não `update()` direto: o render do canvas
 * baixa avatares e codifica um PNG, o que não cabe nos 3 s do token — o mesmo motivo
 * que já obriga a paginação do `/top` a deferir.
 *
 * @param {import('discord.js').MessageComponentInteraction|import('discord.js').ModalSubmitInteraction} interaction
 * @param {import('../utils/levels/types').LevelsConfig} config
 * @param {object|null} changes alterações a gravar, ou `null` para só redesenhar
 * @param {string} notice
 * @param {'top'|'rank'} mode
 */
async function applyAppearance(interaction, config, changes, notice, mode) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const saved = changes ? saveLevelsConfig(interaction.guild.id, { ...config, ...changes }) : config;
  const preview = await renderAppearancePreview({
    guild: interaction.guild,
    member: interaction.member && 'displayName' in interaction.member ? interaction.member : null,
    config: saved,
    mode,
  });

  return interaction.editReply(buildPanelPayload(saved, interaction.guild, 'appearance', notice, preview, mode));
}

/** Mesma alteração de sempre, mas só no objeto `theme`. */
function applyTheme(interaction, config, patch, notice, mode) {
  return applyAppearance(interaction, config, { theme: { ...config.theme, ...patch } }, notice, mode);
}

// ---------------------------------------------------------------------------
// Modais
// ---------------------------------------------------------------------------

const shortInput = (id, label, value, placeholder) =>
  new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(true)
      .setPlaceholder(placeholder ?? '')
      .setValue(String(value))
  );

function openXpModal(interaction, config) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-xp`)
    .setTitle('XP por mensagem e cooldown')
    .addComponents(
      shortInput('xpMin', `XP mínimo (${LIMITS.xp.min}–${LIMITS.xp.max})`, config.xpMin),
      shortInput('xpMax', `XP máximo (${LIMITS.xp.min}–${LIMITS.xp.max})`, config.xpMax),
      shortInput(
        'cooldown',
        `Cooldown em segundos (${LIMITS.cooldownSeconds.min}–${LIMITS.cooldownSeconds.max})`,
        config.cooldownSeconds
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('levels-setup', interaction));
}

function openAntiFarmModal(interaction, config) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-antifarm`)
    .setTitle('Anti-farm')
    .addComponents(
      shortInput(
        'chars',
        `Caracteres úteis mínimos (${LIMITS.minUsefulChars.min}–${LIMITS.minUsefulChars.max})`,
        config.minUsefulChars
      ),
      shortInput('repeat', `Janela de repetição em segundos (0 desliga)`, config.repeatWindowSeconds)
    );

  return interaction.showModal(modal).catch(swallowAckFailure('levels-setup', interaction));
}

function openRewardModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-reward`)
    .setTitle('Recompensa de nível')
    .addComponents(
      shortInput('level', `Nível (1–${MAX_LEVEL})`, '', '10'),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('roles')
          .setLabel(`Cargos — menção ou ID, um por linha`)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(true)
          .setPlaceholder('@Veterano\n123456789012345678')
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('levels-setup', interaction));
}

/**
 * Modal dos campos que não cabem em seletor: os dois textos, a URL e as duas cores.
 *
 * As cores dividem um campo só porque o modal aceita cinco linhas e o painel precisa
 * dos quatro campos anteriores; `#papel / #destaque` é curto o bastante para caber
 * numa linha e explícito o bastante para não precisar de legenda.
 *
 * @param {'top'|'rank'} mode
 */
function openAppearanceModal(interaction, config, mode) {
  const theme = config.theme;
  const colorPair = [theme.cardColor ?? '', theme.accentColor ?? ''].join(' ').trim();

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-appearance:${mode}`)
    .setTitle('Textos e imagem do ranking')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Título — vazio: “Ranking de XP”')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(LIMITS.titleChars)
          .setRequired(false)
          .setPlaceholder('Ranking de XP')
          .setValue(theme.title ?? '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('headline')
          .setLabel('Frase do topo — vazio: nenhuma')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(LIMITS.headlineChars)
          .setRequired(false)
          .setPlaceholder('Quem mais conversou por aqui')
          .setValue(config.headline ?? '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('background')
          .setLabel('Imagem de fundo (URL https) — vazio: padrão')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(400)
          .setRequired(false)
          .setPlaceholder('https://exemplo.com/fundo.png')
          .setValue(config.backgroundUrl ?? '')
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('colors')
          .setLabel('Cores hex: papel destaque — vazio: do tema')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(20)
          .setRequired(false)
          .setPlaceholder('#e8e6de #2a2c34')
          .setValue(colorPair)
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('levels-setup', interaction));
}

/**
 * As duas cores do campo livre.
 *
 * Aceita espaço, barra ou vírgula entre elas, e devolve `null` no que não for hex —
 * `null` é exatamente "usa a cor do tema", então digitar errado volta ao preset em vez
 * de travar o formulário. Quem valida é o `normalizeHexColor`, o mesmo do banco.
 *
 * @param {string} raw
 * @returns {{ cardColor: string|null, accentColor: string|null }}
 */
function parseColorPair(raw) {
  const parts = String(raw ?? '')
    .split(/[\s/,;|]+/)
    .filter(Boolean);

  return {
    cardColor: normalizeHexColor(parts[0] ?? null),
    accentColor: normalizeHexColor(parts[1] ?? null),
  };
}

/**
 * Salva os textos, as cores e o fundo — **baixando a imagem na hora**.
 *
 * Validar só o formato da URL deixaria o admin achando que configurou um fundo
 * que na prática nunca vai aparecer — o `/top` cai no fundo desenhado em silêncio
 * de propósito. Então o preço é um download aqui, e em troca a recusa vem com o
 * motivo exato enquanto a pessoa ainda está no painel.
 *
 * URL ruim **não** é salva: o resto é gravado, o fundo anterior fica como estava.
 *
 * @param {'top'|'rank'} mode
 */
async function submitAppearance(interaction, config, mode) {
  const rawUrl = interaction.fields.getTextInputValue('background').trim();
  const headline = interaction.fields.getTextInputValue('headline');
  const title = interaction.fields.getTextInputValue('title');
  const rawColors = interaction.fields.getTextInputValue('colors').trim();
  const { cardColor, accentColor } = parseColorPair(rawColors);

  let backgroundUrl = null;
  let problem = '';

  if (rawUrl) {
    const result = await fetchRemoteImage(rawUrl, {
      maxBytes: MAX_BACKGROUND_BYTES,
      tooLarge: (kb) =>
        `A imagem tem ${kb} KB. O limite do fundo é ${Math.round(MAX_BACKGROUND_BYTES / 1024)} KB.`,
      notFound: 'Imagem não encontrada nesse link.',
    });

    if (result.ok) backgroundUrl = rawUrl;
    else problem = result.error;
  }

  const notice = problem
    ? `⚠️ Fundo não aceito: ${problem} O resto foi salvo.`
    : rawColors && !cardColor && !accentColor
      ? '⚠️ Nenhuma cor reconhecida: use hex como `#e8e6de`. O resto foi salvo.'
      : '🎨 Aparência salva.';

  return applyAppearance(
    interaction,
    config,
    {
      // Fundo recusado mantém o que já estava salvo: perder o fundo antigo por causa
      // de um erro de digitação no novo seria duas perdas de uma vez.
      backgroundUrl: problem ? config.backgroundUrl : backgroundUrl,
      headline,
      theme: { ...config.theme, title, cardColor, accentColor },
    },
    notice,
    mode
  );
}

/**
 * Qual imagem a prévia mostra, lido do `customId`.
 *
 * Só `'rank'` é aceito explicitamente; qualquer outra coisa é `'top'`, que é a tela
 * de entrada — um `customId` truncado ou de uma versão antiga do painel cai no
 * padrão em vez de quebrar a interação.
 *
 * @param {string|undefined} arg
 * @returns {'top'|'rank'}
 */
const previewMode = (arg) => (arg === 'rank' ? 'rank' : 'top');

/** Ids de cargo em texto livre: aceita `<@&id>`, id puro e listas separadas por linha. */
const parseRoleIds = (raw) => normalizeIds(String(raw ?? '').match(/\d{17,20}/g) ?? [], LIMITS.rolesPerReward);

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

function submitXp(interaction, config) {
  const get = (id) => interaction.fields.getTextInputValue(id);
  // Os valores vão crus para o normalizador: é ele que conhece as faixas, e
  // validar aqui também seria manter duas cópias do mesmo limite.
  const saved = saveLevelsConfig(interaction.guild.id, {
    ...config,
    xpMin: get('xpMin'),
    xpMax: get('xpMax'),
    cooldownSeconds: get('cooldown'),
  });

  const notice = `✨ XP: **${saved.xpMin}–${saved.xpMax}** a cada **${saved.cooldownSeconds}s**.`;
  return safeAck(interaction, () => interaction.update(buildPanelPayload(saved, interaction.guild, 'home', notice)));
}

function submitAntiFarm(interaction, config) {
  const saved = saveLevelsConfig(interaction.guild.id, {
    ...config,
    minUsefulChars: interaction.fields.getTextInputValue('chars'),
    repeatWindowSeconds: interaction.fields.getTextInputValue('repeat'),
  });

  const notice = `🛡️ Mínimo de **${saved.minUsefulChars}** caracteres úteis; repetição ${
    saved.repeatWindowSeconds ? `bloqueada por **${saved.repeatWindowSeconds}s**` : '**desligada**'
  }.`;
  return safeAck(interaction, () => interaction.update(buildPanelPayload(saved, interaction.guild, 'home', notice)));
}

function submitReward(interaction, config) {
  const level = Number.parseInt(interaction.fields.getTextInputValue('level'), 10);
  const roleIds = parseRoleIds(interaction.fields.getTextInputValue('roles'));

  if (!Number.isFinite(level) || level < 1 || level > MAX_LEVEL) {
    return showView(interaction, config, 'rewards', `⚠️ Nível inválido: informe um número entre 1 e ${MAX_LEVEL}.`);
  }
  if (!roleIds.length) {
    return showView(interaction, config, 'rewards', '⚠️ Nenhum cargo reconhecido. Cole a menção do cargo ou o ID dele.');
  }
  const blockedByUser = roleIds
    .map((id) => interaction.guild.roles.cache.get(id))
    .map((role) => validateAssignableRole(interaction, role))
    .filter(Boolean);
  if (blockedByUser.length) return showView(interaction, config, 'rewards', `⚠️ ${blockedByUser.join(' · ')}`);

  // O normalizador mescla níveis repetidos, então adicionar sobre um nível que já
  // existe soma os cargos em vez de sobrescrever — que é a leitura de "editar".
  const saved = saveLevelsConfig(interaction.guild.id, {
    ...config,
    rewards: [...config.rewards, { level, roleIds }],
  });

  const blocked = roleIds.map((id) => roleBlockReason(interaction.guild, id)).filter(Boolean);
  const notice = blocked.length
    ? `⚠️ Salvo, mas: ${blocked.join(' · ')}.`
    : `🎁 Nível **${level}** agora concede ${roleIds.map((id) => `<@&${id}>`).join(' ')}.`;

  return safeAck(interaction, () => interaction.update(buildPanelPayload(saved, interaction.guild, 'rewards', notice)));
}

function removeReward(interaction, config) {
  const level = Number.parseInt(interaction.values[0], 10);
  const rewards = config.rewards.filter((reward) => reward.level !== level);
  return applyChange(interaction, config, { rewards }, `🗑️ Recompensa do nível **${level}** removida.`, 'rewards');
}

function toggleRewardMode(interaction, config) {
  const rewardMode = config.rewardMode === 'stack' ? 'highest' : 'stack';
  return applyChange(
    interaction,
    config,
    { rewardMode },
    `${REWARD_MODES[rewardMode].emoji} Modo: **${REWARD_MODES[rewardMode].label}** — ${REWARD_MODES[rewardMode].description.toLowerCase()}. Vale a partir da próxima reconciliação de cada membro.`,
    'rewards'
  );
}

// ---------------------------------------------------------------------------
// Confirmação do /reset-xp
// ---------------------------------------------------------------------------

/**
 * Botões de confirmação do reset, montados pelo comando.
 *
 * O id do alvo viaja no customId em vez de num Map de sessão: o painel não guarda
 * estado, e uma confirmação pendente que sobrevive a um reinício do bot é melhor
 * que uma que expira em silêncio.
 */
function resetConfirmComponents(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}reset-yes:${userId}`)
        .setLabel('Zerar o XP')
        .setEmoji('♻️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}reset-no:${userId}`)
        .setLabel('Cancelar')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function confirmReset(interaction, config, userId) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const change = resetUserXp({ guildId: interaction.guild.id, userId, source: `reset por ${interaction.user.id}` });
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const problems = [];

  if (member) {
    const sync = await syncMemberRewards(member, config, change.newLevel, `Reset de XP por ${interaction.user.tag}`);
    problems.push(...sync.problems);
  }

  await logEvent(
    interaction.guild,
    '📈 XP zerado',
    `**Usuário:** <@${userId}> (${userId})\n**Administrador:** ${interaction.user.tag}\n` +
      `**XP:** ${change.previousXp} → ${change.totalXp}\n**Nível:** ${change.previousLevel} → ${change.newLevel}`,
    colors.warning
  );

  const lines = [`♻️ XP de <@${userId}> zerado (era **${change.previousXp}**, nível **${change.previousLevel}**).`];
  if (problems.length) lines.push(`⚠️ Cargos: ${problems.join(' · ')}`);

  return interaction.editReply({
    content: '',
    embeds: [successEmbed(lines.join('\n'), '♻️ Reset concluído')],
    components: [],
    allowedMentions: { parse: [] },
  });
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

/** Roteia as interações do painel (`lvl_*`). */
async function routeLevelsSetup(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('É preciso a permissão **Gerenciar Servidor** para alterar o sistema de níveis.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const [action, arg] = interaction.customId.slice(PREFIX.length).split(':');
  const config = getLevelsConfig(interaction.guild.id);

  switch (action) {
    case 'view': {
      const target = VIEWS.includes(arg) ? arg : 'home';
      // A aparência abre pelo caminho assíncrono porque já entra com a prévia
      // desenhada — abrir sem imagem e só mostrá-la no primeiro ajuste faria a tela
      // parecer quebrada justamente na primeira visita.
      if (target === 'appearance') return applyAppearance(interaction, config, null, '', 'top');
      return showView(interaction, config, target);
    }

    case 'toggle':
      return applyChange(
        interaction,
        config,
        { enabled: !config.enabled },
        config.enabled ? '🔴 Sistema de níveis desativado.' : '🟢 Sistema de níveis ativado!'
      );

    case 'xp':
      return openXpModal(interaction, config);
    case 'modal-xp':
      return submitXp(interaction, config);

    case 'antifarm':
      return openAntiFarmModal(interaction, config);
    case 'modal-antifarm':
      return submitAntiFarm(interaction, config);

    case 'ann-toggle':
      return applyChange(
        interaction,
        config,
        { announceEnabled: !config.announceEnabled },
        config.announceEnabled ? '🔕 Anúncios desligados (as recompensas continuam).' : '🔔 Anúncios ligados.',
        'announce'
      );
    case 'ann-channel': {
      const channel = interaction.channels.first();
      if (!channel) return undefined;
      return applyChange(
        interaction,
        config,
        { announceChannelId: channel.id },
        `📍 Anúncios em ${channel}.`,
        'announce'
      );
    }
    case 'ann-current':
      return applyChange(
        interaction,
        config,
        { announceChannelId: null },
        '💬 Os anúncios sairão no canal onde o membro estava conversando.',
        'announce'
      );

    case 'ex-channels':
      return applyChange(
        interaction,
        config,
        { ignoredChannelIds: [...interaction.values] },
        `🚫 ${interaction.values.length} canal(is) sem XP.`,
        'exclusions'
      );
    case 'ex-roles':
      return applyChange(
        interaction,
        config,
        { ignoredRoleIds: [...interaction.values] },
        `🚫 ${interaction.values.length} cargo(s) sem XP.`,
        'exclusions'
      );
    case 'ex-clear':
      return applyChange(
        interaction,
        config,
        { ignoredChannelIds: [], ignoredRoleIds: [] },
        '♻️ Exclusões limpas.',
        'exclusions'
      );

    case 'ap-edit':
      return openAppearanceModal(interaction, config, previewMode(arg));
    case 'modal-appearance':
      return submitAppearance(interaction, config, previewMode(arg));
    case 'ap-mode':
      return applyAppearance(interaction, config, null, '', previewMode(arg));
    case 'ap-preset': {
      const preset = THEME_PRESETS[interaction.values[0]] ? interaction.values[0] : DEFAULT_THEME.preset;
      // O hex do papel é limpo junto: ele sobrepõe o preset, e trocar de tema sem
      // largar a cor antiga deixaria a escolha aparentemente sem efeito.
      return applyTheme(
        interaction,
        config,
        { preset, cardColor: null },
        `🎨 Tema **${THEME_PRESETS[preset].label}**.`,
        previewMode(arg)
      );
    }
    case 'ap-accent': {
      const chosen = interaction.values[0];
      if (chosen === ACCENT_CUSTOM) return openAppearanceModal(interaction, config, previewMode(arg));

      const accent = ACCENT_COLORS[chosen] ? chosen : DEFAULT_THEME.accent;
      return applyTheme(
        interaction,
        config,
        { accent, accentColor: null },
        `✨ Destaque **${ACCENT_COLORS[accent].label}**.`,
        previewMode(arg)
      );
    }
    case 'ap-toggles': {
      const enabled = new Set(interaction.values);
      const patch = Object.fromEntries(THEME_TOGGLES.map((toggle) => [toggle.key, enabled.has(toggle.key)]));
      const off = THEME_TOGGLES.filter((toggle) => !enabled.has(toggle.key));
      return applyTheme(
        interaction,
        config,
        patch,
        off.length ? `👁️ Desligados: ${off.map((t) => t.label.toLowerCase()).join(', ')}.` : '👁️ Todos os elementos ligados.',
        previewMode(arg)
      );
    }
    case 'ap-style': {
      const chosen = String(interaction.values[0] ?? '');
      if (chosen.startsWith('corner-')) {
        const corners = CORNER_STYLES[chosen.slice(7)] ? chosen.slice(7) : DEFAULT_THEME.corners;
        return applyTheme(
          interaction,
          config,
          { corners },
          `🔲 Cantos **${CORNER_STYLES[corners].label.toLowerCase()}**.`,
          previewMode(arg)
        );
      }
      // Valor cru: `normalizeTheme` gruda na faixa, então não há o que validar aqui.
      const veil = chosen.slice(5);
      return applyTheme(interaction, config, { veil }, `🌫️ Véu do fundo em **${veil}%**.`, previewMode(arg));
    }
    case 'ap-reset':
      return applyAppearance(
        interaction,
        config,
        { backgroundUrl: null, headline: null, theme: { ...DEFAULT_THEME } },
        '♻️ Aparência de volta ao padrão do bot.',
        previewMode(arg)
      );

    case 'rw-add':
      return openRewardModal(interaction);
    case 'modal-reward':
      return submitReward(interaction, config);
    case 'rw-remove':
      return removeReward(interaction, config);
    case 'rw-mode':
      return toggleRewardMode(interaction, config);

    case 'reset-yes':
      return confirmReset(interaction, config, arg);
    case 'reset-no':
      return safeAck(interaction, () =>
        interaction.update({ content: '', embeds: [successEmbed('Reset cancelado. Nada foi alterado.')], components: [] })
      );

    case 'close':
      return safeAck(interaction, () =>
        interaction.update({
          content: '',
          embeds: [successEmbed('Painel fechado. As configurações já estão salvas.')],
          components: [],
        })
      );

    default:
      return undefined;
  }
}

module.exports = {
  PREFIX,
  VIEWS,
  idleWarnings,
  parseRoleIds,
  buildPanelPayload,
  resetConfirmComponents,
  routeLevelsSetup,
};
