/**
 * Painel interativo do /config-emojis.
 *
 * Cada alteração é salva na hora (como no /setup-welcome): mexer num emoji é
 * reversível com um clique em "Restaurar padrão", então não vale a pena o custo
 * de um rascunho com confirmação.
 *
 * O emoji novo não é digitado num formulário — o bot pede para o usuário mandar
 * o emoji no chat e escuta a próxima mensagem dele. É bem mais fácil: dá para
 * usar o teclado de emojis do Discord, e emoji personalizado sai já no formato
 * certo sem precisar da gambiarra da barra invertida.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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
  extractFirstEmoji,
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

/** Quanto tempo o bot espera a mensagem com o emoji. */
const CAPTURE_MS = 60_000;

/** Palavras que o usuário pode mandar no chat em vez de um emoji. */
const CANCEL_WORDS = ['cancelar', 'cancel'];
const RESET_WORDS = ['padrao', 'padrão', 'reset', 'resetar', 'limpar'];

/**
 * Coletores ativos, por mensagem de painel. Serve para o botão "Cancelar"
 * encontrar o coletor certo e para trocar de chave não deixar dois escutando.
 * @type {Map<string, import('discord.js').MessageCollector>}
 */
const captures = new Map();

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
        'Esses emojis personalizados não estão em nenhum servidor do bot. Ele usa o padrão no ' +
        'lugar até você corrigir.',
    });
  }

  return baseEmbed({
    title: '😀 Emojis do bot',
    description:
      'Escolha um emoji na lista: o bot vai pedir para você **mandar o emoji novo aqui no chat**.\n' +
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

/** Tela de espera: o painel some para não dar dois cliques enquanto o bot escuta. */
function buildCapturePanel(guild, key) {
  const meta = REGISTRY[key];
  const current = getGuildEmojis(guild.id)[key];

  return {
    content: `⌨️ **Mande o emoji novo aqui no chat** — você tem ${CAPTURE_MS / 1000} segundos.`,
    embeds: [
      baseEmbed({
        title: `${current} Trocando: ${meta.label}`,
        description: [
          `**Onde aparece:** ${meta.usage}`,
          `**Agora:** ${current} · **Padrão:** ${meta.default}`,
          '',
          'Mande na conversa um emoji normal ou um emoji personalizado de qualquer servidor ' +
            'em que o bot esteja. Eu apago sua mensagem depois de ler.',
          '',
          `Ou escreva \`${RESET_WORDS[0]}\` para voltar ao padrão e \`${CANCEL_WORDS[0]}\` para desistir.`,
        ].join('\n'),
        color: colors.info,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}cancel`)
          .setLabel('Cancelar')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
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

/**
 * Volta ao painel depois que a interação já foi ackada — é o caso do coletor,
 * que responde minutos depois do clique no select.
 */
async function repaint(interaction, notice) {
  try {
    await interaction.editReply(buildEmojiPanel(interaction.guild, notice));
  } catch (err) {
    // Token de 15 min expirado ou painel fechado: nada a fazer.
    console.warn('[config-emojis] Não foi possível repintar o painel:', err.message);
  }
}

/** Apaga a mensagem lida, para o canal não ficar com emojis soltos. */
async function tidyUp(message) {
  if (!message.deletable) return;
  await message.delete().catch(() => {});
}

/** Aplica o que o usuário mandou no chat à chave em edição. */
async function applyCaptured(interaction, key, message) {
  const meta = REGISTRY[key];
  const text = message.content.trim();
  const word = text.toLowerCase();

  await tidyUp(message);

  if (CANCEL_WORDS.includes(word)) return repaint(interaction, '↩️ Alteração cancelada.');

  if (RESET_WORDS.includes(word)) {
    resetGuildEmoji(interaction.guild.id, key);
    return repaint(interaction, `♻️ **${meta.label}** voltou ao padrão ${meta.default}.`);
  }

  const found = extractFirstEmoji(text);
  if (!found) {
    return repaint(
      interaction,
      `⚠️ Não encontrei nenhum emoji em "${text.slice(0, 60)}". **${meta.label}** ficou como estava — ` +
        'escolha na lista para tentar de novo.'
    );
  }

  const parsed = parseEmojiInput(found);
  if (!parsed.ok) return repaint(interaction, `⚠️ ${parsed.error}`);

  // Emoji personalizado que o bot não alcança não renderiza e quebraria os
  // botões, então é recusado aqui em vez de virar erro na hora de usar.
  const custom = parseCustomEmoji(parsed.value);
  if (custom && !interaction.client.emojis.cache.has(custom.id)) {
    return repaint(
      interaction,
      `⚠️ Não consigo usar \`:${custom.name}:\` — ele está num servidor onde eu não estou. ` +
        'Adicione-o aqui com `/emoji-add` e tente de novo.'
    );
  }

  setGuildEmoji(interaction.guild.id, key, parsed.value);
  return repaint(interaction, `${parsed.value} **${meta.label}** atualizado.`);
}

/**
 * Mostra a tela de espera e escuta a próxima mensagem de quem clicou.
 * O coletor filtra por autor, então outra pessoa conversando no canal não
 * atrapalha a configuração.
 */
async function startCapture(interaction, key) {
  const channel = interaction.channel;
  if (!channel) {
    return redraw(interaction, '⚠️ Não consigo escutar este canal. Use o comando num canal de texto normal.');
  }

  const acked = await safeAck(interaction, () => interaction.update(buildCapturePanel(interaction.guild, key)));
  if (!acked) return undefined;

  const panelId = interaction.message.id;
  captures.get(panelId)?.stop('substituido');

  const collector = channel.createMessageCollector({
    filter: (message) => message.author.id === interaction.user.id,
    max: 1,
    time: CAPTURE_MS,
  });
  captures.set(panelId, collector);

  collector.on('end', async (collected, reason) => {
    if (captures.get(panelId) === collector) captures.delete(panelId);
    // Nos dois casos quem parou o coletor já cuidou da tela.
    if (reason === 'substituido' || reason === 'cancelado') return;

    const message = collected.first();
    if (!message) {
      await repaint(interaction, '⌛ Tempo esgotado, nada foi alterado.');
      return;
    }

    try {
      await applyCaptured(interaction, key, message);
    } catch (err) {
      console.error('[config-emojis] Erro ao aplicar emoji do chat:', err);
      await repaint(interaction, '⚠️ Algo deu errado ao salvar. Tente de novo.');
    }
  });

  return undefined;
}

function handleCancel(interaction) {
  captures.get(interaction.message.id)?.stop('cancelado');
  return redraw(interaction, '↩️ Alteração cancelada.');
}

function handleResetAll(interaction) {
  captures.get(interaction.message.id)?.stop('cancelado');
  resetGuildEmojis(interaction.guild.id);
  return redraw(interaction, '♻️ Todos os emojis voltaram ao padrão.');
}

function handleClose(interaction) {
  captures.get(interaction.message.id)?.stop('cancelado');
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
    return startCapture(interaction, key);
  }
  if (action === 'cancel') return handleCancel(interaction);
  if (action === 'resetall') return handleResetAll(interaction);
  if (action === 'close') return handleClose(interaction);
  return undefined;
}

module.exports = { PREFIX, CAPTURE_MS, buildEmojiPanel, isAllowed, routeEmojiConfig };
