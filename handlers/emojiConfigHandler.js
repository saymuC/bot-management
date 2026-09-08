/**
 * Painel interativo do /config-emojis.
 *
 * Cada alteração é salva na hora (como no /setup-welcome): mexer num emoji é
 * reversível com um clique em "Restaurar padrão", então não vale a pena o custo
 * de um rascunho com confirmação.
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
  CATEGORIES,
  REGISTRY,
  KEYS,
  DEFAULT_EMOJIS,
  parseEmojiInput,
  parseCustomEmoji,
  getGuildEmojis,
  setGuildEmoji,
  resetGuildEmoji,
  resetGuildEmojis,
  isBrokenCustomEmoji,
  emoji,
} = require('../utils/emojis');

const PREFIX = 'cfgemoji_';

/** Marca visual de cada chave no painel. */
function statusOf(guild, key, value) {
  if (isBrokenCustomEmoji(guild, value)) return '⚠️';
  return value === DEFAULT_EMOJIS[key] ? '·' : '✏️';
}

function panelEmbed(guild, emojis) {
  const broken = KEYS.filter((key) => isBrokenCustomEmoji(guild, emojis[key]));
  const changed = KEYS.filter((key) => emojis[key] !== DEFAULT_EMOJIS[key]);

  const fields = Object.entries(CATEGORIES).map(([category, label]) => ({
    name: label,
    value: KEYS.filter((key) => REGISTRY[key].category === category)
      .map((key) => `${statusOf(guild, key, emojis[key])} ${emojis[key]} — ${REGISTRY[key].label}`)
      .join('\n'),
    inline: true,
  }));

  if (broken.length) {
    fields.push({
      name: '⚠️ Emojis indisponíveis',
      value:
        `${broken.map((key) => `• **${REGISTRY[key].label}** — ${emojis[key]}`).join('\n')}\n\n` +
        'Esses emojis personalizados não estão mais neste servidor. O bot usa o padrão no lugar ' +
        'até você corrigir.',
    });
  }

  return baseEmbed({
    title: '😀 Emojis do bot',
    description:
      'Escolha um emoji na lista para trocar. Aceita emoji normal (🎫) ou personalizado deste servidor.\n' +
      '`✏️` = alterado · `·` = padrão',
    color: broken.length ? colors.warning : colors.primary,
    fields,
    footer: `${changed.length} de ${KEYS.length} personalizados · vale só neste servidor`,
  });
}

function panelComponents(guild, emojis) {
  const changed = KEYS.some((key) => emojis[key] !== DEFAULT_EMOJIS[key]);

  const pickRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}pick`)
      .setPlaceholder('Escolha o emoji que quer trocar')
      .addOptions(
        KEYS.map((key) => ({
          label: REGISTRY[key].label,
          value: key,
          // emoji() já cai no padrão se o personalizado sumiu: um id inválido
          // aqui faria o Discord recusar a mensagem inteira.
          emoji: emoji(guild, key),
          description: REGISTRY[key].usage.slice(0, 100),
        }))
      )
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}resetall`)
      .setLabel('Restaurar todos')
      .setEmoji('♻️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!changed),
    new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  return [pickRow, actionRow];
}

/**
 * Payload do painel. `notice` é o feedback da última ação.
 * @param {import('discord.js').Guild} guild
 */
function buildEmojiPanel(guild, notice = '') {
  const emojis = getGuildEmojis(guild.id);
  const header = ['🎛️ **Painel de emojis** — só você vê isto.'];
  if (notice) header.push(notice);

  return {
    content: header.join('\n'),
    embeds: [panelEmbed(guild, emojis)],
    components: panelComponents(guild, emojis),
  };
}

/** Acka tolerando token morto/duplicado (mesma razão dos outros painéis). */
async function safeAck(interaction, ack) {
  try {
    await ack();
    return true;
  } catch (err) {
    if (err.code === 10062 || err.code === 40060) {
      console.warn(`[config-emojis] Interação ${interaction.customId} não ackável (${err.code}); ignorada.`);
      return false;
    }
    throw err;
  }
}

function redraw(interaction, notice) {
  return safeAck(interaction, () => interaction.update(buildEmojiPanel(interaction.guild, notice)));
}

function openEmojiModal(interaction, key) {
  const meta = REGISTRY[key];
  const current = getGuildEmojis(interaction.guild.id)[key];

  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}modal-${key}`)
    .setTitle(`Emoji: ${meta.label}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('value')
        .setLabel(`Novo emoji — vazio volta ao ${meta.default}`)
        .setPlaceholder('🎫 ou <:nome:123456789012345678>')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(64)
        .setRequired(false)
        .setValue(current)
    )
  );

  return interaction.showModal(modal).catch(() => {});
}

function handleEmojiSubmit(interaction, key) {
  const raw = interaction.fields.getTextInputValue('value').trim();
  const meta = REGISTRY[key];

  if (!raw) {
    resetGuildEmoji(interaction.guild.id, key);
    return redraw(interaction, `♻️ **${meta.label}** voltou ao padrão ${meta.default}.`);
  }

  const parsed = parseEmojiInput(raw);
  if (!parsed.ok) return redraw(interaction, `⚠️ ${parsed.error}`);

  // Emoji personalizado de outro servidor não renderiza e quebraria os botões,
  // então é recusado aqui em vez de virar um erro na hora de usar.
  const custom = parseCustomEmoji(parsed.value);
  if (custom && !interaction.guild.emojis.cache.has(custom.id)) {
    return redraw(
      interaction,
      '⚠️ Esse emoji personalizado não é deste servidor. Envie um emoji do próprio servidor ou um emoji normal.'
    );
  }

  setGuildEmoji(interaction.guild.id, key, parsed.value);
  return redraw(interaction, `${parsed.value} **${meta.label}** atualizado.`);
}

function handleResetAll(interaction) {
  resetGuildEmojis(interaction.guild.id);
  return redraw(interaction, '♻️ Todos os emojis voltaram ao padrão.');
}

function handleClose(interaction) {
  return safeAck(interaction, () =>
    interaction.update({ content: '', embeds: [successEmbed('Painel fechado.')], components: [] })
  );
}

function isAllowed(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

/** Roteia as interações do painel (`cfgemoji_*`). */
async function routeEmojiConfig(interaction) {
  if (!interaction.inGuild()) return undefined;
  if (!isAllowed(interaction)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Você precisa ser administrador para alterar os emojis do bot.')],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const action = interaction.customId.slice(PREFIX.length);

  if (action === 'pick') {
    const key = interaction.values[0];
    if (!Object.hasOwn(REGISTRY, key)) return redraw(interaction, '⚠️ Esse emoji não existe mais.');
    return openEmojiModal(interaction, key);
  }
  if (action.startsWith('modal-')) {
    const key = action.slice('modal-'.length);
    if (!Object.hasOwn(REGISTRY, key)) return redraw(interaction, '⚠️ Esse emoji não existe mais.');
    return handleEmojiSubmit(interaction, key);
  }
  if (action === 'resetall') return handleResetAll(interaction);
  if (action === 'close') return handleClose(interaction);
  return undefined;
}

module.exports = { PREFIX, buildEmojiPanel, isAllowed, routeEmojiConfig };
