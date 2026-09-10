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
const { LIMITS, REWARD_MODES, MAX_BACKGROUND_BYTES } = require('../config/levels');
const { fetchRemoteImage } = require('../utils/remoteImage');
const { checkCanvasFonts } = require('../utils/canvasFonts');
const { MAX_LEVEL } = require('../utils/levels/formula');
const { getLevelsConfig, saveLevelsConfig, normalizeIds } = require('../utils/levels/config');
const { roleBlockReason, syncMemberRewards } = require('../utils/levels/rewards');
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

function appearancePayload(config, guild, notice) {
  const fonts = checkCanvasFonts();

  const embed = baseEmbed({
    title: '🎨 Aparência do ranking',
    description: [
      'O `/top` e o `/rank` respondem com uma imagem gerada pelo bot. Aqui dá para trocar o fundo dela e escrever uma frase no topo.',
      '',
      `**Imagem de fundo:** ${config.backgroundUrl ? `[link](${config.backgroundUrl})` : '_padrão desenhado pelo bot_'}`,
      `**Frase do topo:** ${config.headline ? `“${config.headline}”` : '_nenhuma_'}`,
      '',
      'A URL precisa ser `https`, apontar para uma imagem em endereço público e caber em ' +
        `${Math.round(MAX_BACKGROUND_BYTES / 1024 / 1024)} MB. A imagem é cortada para cobrir o card, e um véu escuro entra por cima dela para o texto continuar legível.`,
      fonts.ok ? '' : `\n⚠️ ${fonts.reason}`,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: `Frase: até ${LIMITS.headlineChars} caracteres`,
  });

  return {
    content: notice || '',
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}ap-edit`)
          .setLabel('Editar')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}ap-reset`)
          .setLabel('Voltar ao padrão')
          .setEmoji('♻️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!config.backgroundUrl && !config.headline),
        new ButtonBuilder().setCustomId(`${PREFIX}view:home`).setLabel('Voltar').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
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
 */
function buildPanelPayload(config, guild, view = 'home', notice = '') {
  if (view === 'announce') return announcePayload(config, guild, notice);
  if (view === 'exclusions') return exclusionsPayload(config, guild, notice);
  if (view === 'rewards') return rewardsPayload(config, guild, notice);
  if (view === 'appearance') return appearancePayload(config, guild, notice);

  return {
    content: notice || '🔧 **Painel de níveis** — só você vê isto.',
    embeds: [homeEmbed(config, guild)],
    components: homeComponents(config),
    allowedMentions: { parse: [] },
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

function openAppearanceModal(interaction, config) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-appearance`)
    .setTitle('Aparência do ranking')
    .addComponents(
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
          .setCustomId('headline')
          .setLabel('Frase do topo — vazio: nenhuma')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(LIMITS.headlineChars)
          .setRequired(false)
          .setPlaceholder('Quem mais conversou por aqui')
          .setValue(config.headline ?? '')
      )
    );

  return interaction.showModal(modal).catch(swallowAckFailure('levels-setup', interaction));
}

/**
 * Salva a aparência, **baixando a imagem na hora**.
 *
 * Validar só o formato da URL deixaria o admin achando que configurou um fundo
 * que na prática nunca vai aparecer — o `/top` cai no fundo desenhado em silêncio
 * de propósito. Então o preço é um download aqui, e em troca a recusa vem com o
 * motivo exato enquanto a pessoa ainda está no painel.
 *
 * URL ruim **não** é salva: a frase é gravada, o fundo anterior fica como estava.
 */
async function submitAppearance(interaction, config) {
  if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;

  const rawUrl = interaction.fields.getTextInputValue('background').trim();
  const headline = interaction.fields.getTextInputValue('headline');

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

  const saved = saveLevelsConfig(interaction.guild.id, {
    ...config,
    // Fundo recusado mantém o que já estava salvo: perder o fundo antigo por causa
    // de um erro de digitação no novo seria duas perdas de uma vez.
    backgroundUrl: problem ? config.backgroundUrl : backgroundUrl,
    headline,
  });

  const notice = problem
    ? `⚠️ Fundo não aceito: ${problem} A frase foi salva.`
    : saved.backgroundUrl
      ? '🎨 Fundo e frase salvos. Rode `/top` para ver.'
      : '♻️ Aparência salva com o fundo padrão do bot.';

  return interaction.editReply(buildPanelPayload(saved, interaction.guild, 'appearance', notice));
}

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
    case 'view':
      return showView(interaction, config, VIEWS.includes(arg) ? arg : 'home');

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
      return openAppearanceModal(interaction, config);
    case 'modal-appearance':
      return submitAppearance(interaction, config);
    case 'ap-reset':
      return applyChange(
        interaction,
        config,
        { backgroundUrl: null, headline: null },
        '♻️ Aparência de volta ao padrão: fundo desenhado pelo bot e sem frase.',
        'appearance'
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
