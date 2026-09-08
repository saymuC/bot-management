/**
 * Painel interativo do /bot-status.
 *
 * Diferente do /setup-welcome, aqui **nada é salvo automaticamente**: o status
 * vale para todos os servidores, então as alterações ficam num rascunho em
 * memória e só entram no ar quando o usuário clica em "Aplicar".
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { colors } = require('../config/settings');
const {
  STATUSES,
  ACTIVITIES,
  DEFAULT_PRESENCE,
  isStreamUrl,
  normalizePresence,
  getSavedPresence,
  savePresence,
  applyPresence,
  describePresence,
  presenceWarnings,
} = require('../utils/presence');

const PREFIX = 'bstatus_';
/** Tempo que um rascunho abandonado fica na memória. */
const DRAFT_TTL_MS = 15 * 60 * 1000;

/** Rascunhos por usuário: { presence, touchedAt }. */
const drafts = new Map();

function pruneDrafts(now) {
  for (const [userId, draft] of drafts) {
    if (now - draft.touchedAt >= DRAFT_TTL_MS) drafts.delete(userId);
  }
}

/** Rascunho do usuário, começando da presença que está no ar. */
function getDraft(userId) {
  const now = Date.now();
  pruneDrafts(now);
  const existing = drafts.get(userId);
  if (existing) return existing.presence;

  const presence = getSavedPresence();
  drafts.set(userId, { presence, touchedAt: now });
  return presence;
}

/** Grava o rascunho (sempre um objeto novo) e devolve a versão normalizada. */
function setDraft(userId, changes) {
  const presence = normalizePresence({ ...getDraft(userId), ...changes });
  drafts.set(userId, { presence, touchedAt: Date.now() });
  return presence;
}

function clearDraft(userId) {
  drafts.delete(userId);
}

/** True quando o rascunho difere do que está aplicado. */
function isDirty(draft, applied) {
  return JSON.stringify(draft) !== JSON.stringify(applied);
}

function panelEmbed(draft, applied) {
  const dirty = isDirty(draft, applied);
  const meta = ACTIVITIES[draft.activity];
  const warnings = presenceWarnings(draft);

  const fields = [
    { name: 'No ar agora', value: describePresence(applied) },
    { name: dirty ? '📝 Rascunho (não aplicado)' : '✅ Rascunho', value: describePresence(draft) },
    { name: 'Disponibilidade', value: STATUSES[draft.status].label, inline: true },
    { name: 'Tipo', value: `${meta.emoji} ${meta.label}`, inline: true },
    { name: 'Nome / texto', value: draft.name ? `\`${draft.name}\`` : '⚠️ vazio', inline: true },
    { name: 'Linha extra (state)', value: draft.state ? `\`${draft.state}\`` : 'nenhuma', inline: true },
    {
      name: 'Link da transmissão',
      value: draft.url ? `${isStreamUrl(draft.url) ? '🔗' : '⚠️'} [abrir](${draft.url})` : 'nenhum',
      inline: true,
    },
    { name: 'Como vai aparecer', value: meta.hint, inline: true },
  ];

  if (warnings.length) fields.push({ name: '⚠️ Atenção', value: warnings.map((w) => `• ${w}`).join('\n') });

  fields.push({
    name: '🔘 Sobre botões na atividade',
    value:
      'A API do Discord permite que **bots** definam apenas `nome`, `linha extra`, `tipo` e `url`.\n' +
      'Botões de Rich Presence e imagens são ignorados para bots — o único elemento **clicável** é o tipo ' +
      '`Transmitindo`, em que o título vira link (só `twitch.tv` e `youtube.com`).',
  });

  return baseEmbed({
    title: '🤖 Status do bot',
    description: dirty
      ? 'Você tem alterações **pendentes**. Nada muda até clicar em **Aplicar**.'
      : 'O rascunho está igual ao que já está no ar.',
    color: dirty ? colors.warning : colors.success,
    fields,
    footer: 'Vale para todos os servidores · rascunho expira em 15 min',
  });
}

function panelComponents(draft, applied) {
  const dirty = isDirty(draft, applied);

  const statusRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}status`)
      .setPlaceholder(`Disponibilidade — atual: ${STATUSES[draft.status].label}`)
      .addOptions(
        Object.entries(STATUSES).map(([value, meta]) => ({ label: meta.label, value, default: value === draft.status }))
      )
  );

  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}type`)
      .setPlaceholder(`Tipo de atividade — atual: ${ACTIVITIES[draft.activity].label}`)
      .addOptions(
        Object.entries(ACTIVITIES).map(([value, meta]) => ({
          label: meta.label,
          value,
          emoji: meta.emoji,
          description: meta.hint.slice(0, 100),
          default: value === draft.activity,
        }))
      )
  );

  const editRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}texts`).setLabel('Textos').setEmoji('✏️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}link`).setLabel('Link da live').setEmoji('🔗').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}default`).setLabel('Restaurar padrão').setEmoji('♻️').setStyle(ButtonStyle.Secondary)
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}apply`)
      .setLabel(dirty ? 'Aplicar alterações' : 'Nada para aplicar')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!dirty),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}discard`)
      .setLabel('Descartar')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!dirty),
    new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  return [statusRow, typeRow, editRow, actionRow];
}

/**
 * Payload do painel. `notice` é a linha de feedback da última ação.
 * @param {string} userId dono do rascunho
 */
function buildStatusPanel(userId, notice = '') {
  const applied = getSavedPresence();
  const draft = getDraft(userId);
  const header = ['🎛️ **Painel de status do bot** — só você vê isto.'];
  if (notice) header.push(notice);

  return {
    content: header.join('\n'),
    embeds: [panelEmbed(draft, applied)],
    components: panelComponents(draft, applied),
  };
}

/** Acka tolerando token morto/duplicado (mesma razão do embedHandler). */
async function safeAck(interaction, ack) {
  try {
    await ack();
    return true;
  } catch (err) {
    if (err.code === 10062 || err.code === 40060) {
      console.warn(`[bot-status] Interação ${interaction.customId} não ackável (${err.code}); ignorada.`);
      return false;
    }
    throw err;
  }
}

function redraw(interaction, notice) {
  return safeAck(interaction, () => interaction.update(buildStatusPanel(interaction.user.id, notice)));
}

function handleTextsModal(interaction, draft) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-texts`).setTitle('Textos da atividade');

  modal.addComponents(
    [
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Nome (texto principal)')
        .setPlaceholder('o servidor 👀')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(128)
        .setRequired(false)
        .setValue(draft.name ?? ''),
      new TextInputBuilder()
        .setCustomId('state')
        .setLabel('Linha extra (state) — opcional')
        .setPlaceholder('No tipo Personalizado, este é o texto exibido')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(128)
        .setRequired(false)
        .setValue(draft.state ?? ''),
    ].map((input) => new ActionRowBuilder().addComponents(input))
  );

  return interaction.showModal(modal).catch(() => {});
}

function handleLinkModal(interaction, draft) {
  const modal = new ModalBuilder().setCustomId(`${PREFIX}modal-link`).setTitle('Link da transmissão');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('url')
        .setLabel('URL Twitch/YouTube — vazio remove')
        .setPlaceholder('https://twitch.tv/seucanal')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(512)
        .setRequired(false)
        .setValue(draft.url ?? '')
    )
  );

  return interaction.showModal(modal).catch(() => {});
}

function handleTextsSubmit(interaction) {
  const name = interaction.fields.getTextInputValue('name').trim();
  const state = interaction.fields.getTextInputValue('state').trim();
  setDraft(interaction.user.id, { name, state });
  return redraw(interaction, '✏️ Textos atualizados no rascunho. Clique em **Aplicar** para valer.');
}

function handleLinkSubmit(interaction) {
  const raw = interaction.fields.getTextInputValue('url').trim();

  if (!raw) {
    setDraft(interaction.user.id, { url: null });
    return redraw(interaction, '🔗 Link removido do rascunho.');
  }
  if (!isStreamUrl(raw)) {
    return redraw(interaction, '⚠️ Link ignorado: o Discord só aceita `https://twitch.tv/...` ou `https://youtube.com/...`.');
  }

  setDraft(interaction.user.id, { url: raw, activity: 'streaming' });
  return redraw(interaction, '🔗 Link salvo no rascunho e tipo trocado para **Transmitindo**.');
}

/** Aqui é o único ponto que mexe no bot de verdade. */
async function handleApply(interaction) {
  const draft = getDraft(interaction.user.id);

  try {
    const applied = applyPresence(interaction.client, draft);
    savePresence(applied);
    clearDraft(interaction.user.id);
    console.log(`[presence] ${interaction.user.tag} alterou para: ${describePresence(applied)}`);

    return safeAck(interaction, () =>
      interaction.update({
        content: '',
        embeds: [successEmbed(`Status aplicado e salvo:\n\n${describePresence(applied)}`)],
        components: [],
      })
    );
  } catch (err) {
    console.error('[bot-status] Falha ao aplicar presença:', err.message);
    return redraw(interaction, '⚠️ Não consegui aplicar esse status. Confira os textos e tente de novo.');
  }
}

function handleDiscard(interaction) {
  clearDraft(interaction.user.id);
  return redraw(interaction, '↩️ Alterações descartadas — voltou ao que está no ar.');
}

function handleDefault(interaction) {
  setDraft(interaction.user.id, { ...DEFAULT_PRESENCE });
  return redraw(interaction, '♻️ Rascunho com o status padrão. Clique em **Aplicar** para confirmar.');
}

function handleClose(interaction) {
  const dirty = isDirty(getDraft(interaction.user.id), getSavedPresence());
  clearDraft(interaction.user.id);
  return safeAck(interaction, () =>
    interaction.update({
      content: '',
      embeds: [
        successEmbed(dirty ? 'Painel fechado. As alterações pendentes foram descartadas.' : 'Painel fechado.'),
      ],
      components: [],
    })
  );
}

/**
 * A presença é global, então quando OWNER_ID está definido só o dono altera —
 * um admin de um servidor qualquer não deveria mudar como o bot aparece nos outros.
 */
function isAllowed(interaction) {
  const ownerId = process.env.OWNER_ID?.trim();
  if (ownerId) return interaction.user.id === ownerId;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

/** Roteia as interações do painel (`bstatus_*`). */
async function routeBotStatus(interaction) {
  if (!isAllowed(interaction)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Você não tem permissão para alterar o status do bot.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const action = interaction.customId.slice(PREFIX.length);
  const draft = getDraft(interaction.user.id);

  switch (action) {
    case 'status':
      setDraft(interaction.user.id, { status: interaction.values[0] });
      return redraw(interaction, `${STATUSES[interaction.values[0]].label} no rascunho.`);
    case 'type':
      setDraft(interaction.user.id, { activity: interaction.values[0] });
      return redraw(interaction, `${ACTIVITIES[interaction.values[0]].emoji} Tipo **${ACTIVITIES[interaction.values[0]].label}** no rascunho.`);
    case 'texts':
      return handleTextsModal(interaction, draft);
    case 'link':
      return handleLinkModal(interaction, draft);
    case 'modal-texts':
      return handleTextsSubmit(interaction);
    case 'modal-link':
      return handleLinkSubmit(interaction);
    case 'apply':
      return handleApply(interaction);
    case 'discard':
      return handleDiscard(interaction);
    case 'default':
      return handleDefault(interaction);
    case 'close':
      return handleClose(interaction);
    default:
      return undefined;
  }
}

module.exports = { PREFIX, DRAFT_TTL_MS, buildStatusPanel, clearDraft, isAllowed, routeBotStatus };
