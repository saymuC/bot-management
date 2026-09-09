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
  CATEGORY_KEYS,
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
const { makeSafeAck } = require('../utils/interactionAck');

const PREFIX = 'cfgemoji_';

/** Categoria mostrada quando o painel abre. */
const DEFAULT_CATEGORY = Object.keys(CATEGORIES)[0];

/** Categoria válida, ou a primeira — protege contra customId adulterado. */
const safeCategory = (value) => (Object.hasOwn(CATEGORIES, value) ? value : DEFAULT_CATEGORY);

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

function panelEmbed(guild, emojis, category) {
  const broken = KEYS.filter((key) => isBrokenCustomEmoji(guild, emojis[key]));
  const changed = KEYS.filter((key) => emojis[key] !== DEFAULT_EMOJIS[key]);

  const fields = Object.entries(CATEGORIES).map(([name, label]) => ({
    name: name === category ? `▸ ${label}` : label,
    value: CATEGORY_KEYS[name]
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
      `Mostrando **${CATEGORIES[category]}**. Escolha um emoji na lista: o bot vai pedir para você ` +
      '**mandar o emoji novo aqui no chat**.\n`✏️` = alterado · `·` = padrão',
    color: broken.length ? colors.warning : colors.primary,
    fields,
    footer: `${changed.length} de ${KEYS.length} personalizados · vale só neste servidor`,
  });
}

/**
 * As opções do select de chaves vêm só da categoria aberta.
 *
 * Um select do Discord aceita 25 opções e o registro já passa disso — filtrar por
 * categoria mantém o painel válido por construção, sem precisar cortar a lista.
 */
function panelComponents(guild, emojis, category) {
  const changed = KEYS.some((key) => emojis[key] !== DEFAULT_EMOJIS[key]);

  const categoryRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}cat`)
      .setPlaceholder('Categoria')
      .addOptions(
        Object.entries(CATEGORIES).map(([name, label]) => ({
          label,
          value: name,
          default: name === category,
          description: `${CATEGORY_KEYS[name].length} emoji(s)`,
        }))
      )
  );

  const pickRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}pick:${category}`)
      .setPlaceholder(`Escolha o emoji que quer trocar — ${CATEGORIES[category]}`)
      .addOptions(
        CATEGORY_KEYS[category].map((key) => ({
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
      .setCustomId(`${PREFIX}resetall:${category}`)
      .setLabel('Restaurar todos')
      .setEmoji('♻️')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!changed),
    new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  return [categoryRow, pickRow, actionRow];
}

/**
 * Payload do painel. `notice` é o feedback da última ação.
 * @param {import('discord.js').Guild} guild
 * @param {string} notice
 * @param {string} category categoria aberta
 */
function buildEmojiPanel(guild, notice = '', category = DEFAULT_CATEGORY) {
  const open = safeCategory(category);
  const emojis = getGuildEmojis(guild.id);
  const header = ['🎛️ **Painel de emojis** — só você vê isto.'];
  if (notice) header.push(notice);

  return {
    content: header.join('\n'),
    embeds: [panelEmbed(guild, emojis, open)],
    components: panelComponents(guild, emojis, open),
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
          // A categoria vem da própria chave: cancelar devolve o painel na
          // mesma aba de onde o usuário saiu.
          .setCustomId(`${PREFIX}cancel:${meta.category}`)
          .setLabel('Cancelar')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
  };
}

/** Acka tolerando token morto/duplicado (mesma razão dos outros painéis). */
const safeAck = makeSafeAck('config-emojis');

function redraw(interaction, notice, category) {
  return safeAck(interaction, () => interaction.update(buildEmojiPanel(interaction.guild, notice, category)));
}

/**
 * Volta ao painel depois que a interação já foi ackada — é o caso do coletor,
 * que responde minutos depois do clique no select.
 */
async function repaint(interaction, notice, category) {
  try {
    await interaction.editReply(buildEmojiPanel(interaction.guild, notice, category));
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
  const back = meta.category;
  const text = message.content.trim();
  const word = text.toLowerCase();

  await tidyUp(message);

  if (CANCEL_WORDS.includes(word)) return repaint(interaction, '↩️ Alteração cancelada.', back);

  if (RESET_WORDS.includes(word)) {
    resetGuildEmoji(interaction.guild.id, key);
    return repaint(interaction, `♻️ **${meta.label}** voltou ao padrão ${meta.default}.`, back);
  }

  const found = extractFirstEmoji(text);
  if (!found) {
    return repaint(
      interaction,
      `⚠️ Não encontrei nenhum emoji em "${text.slice(0, 60)}". **${meta.label}** ficou como estava — ` +
        'escolha na lista para tentar de novo.',
      back
    );
  }

  const parsed = parseEmojiInput(found);
  if (!parsed.ok) return repaint(interaction, `⚠️ ${parsed.error}`, back);

  // Emoji personalizado que o bot não alcança não renderiza e quebraria os
  // botões, então é recusado aqui em vez de virar erro na hora de usar.
  const custom = parseCustomEmoji(parsed.value);
  if (custom && !interaction.client.emojis.cache.has(custom.id)) {
    return repaint(
      interaction,
      `⚠️ Não consigo usar \`:${custom.name}:\` — ele está num servidor onde eu não estou. ` +
        'Adicione-o aqui com `/emoji-add` e tente de novo.',
      back
    );
  }

  setGuildEmoji(interaction.guild.id, key, parsed.value);
  return repaint(interaction, `${parsed.value} **${meta.label}** atualizado.`, back);
}

/**
 * Mostra a tela de espera e escuta a próxima mensagem de quem clicou.
 * O coletor filtra por autor, então outra pessoa conversando no canal não
 * atrapalha a configuração.
 */
async function startCapture(interaction, key) {
  const channel = interaction.channel;
  if (!channel) {
    return redraw(
      interaction,
      '⚠️ Não consigo escutar este canal. Use o comando num canal de texto normal.',
      REGISTRY[key].category
    );
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
      await repaint(interaction, '⌛ Tempo esgotado, nada foi alterado.', REGISTRY[key].category);
      return;
    }

    try {
      await applyCaptured(interaction, key, message);
    } catch (err) {
      console.error('[config-emojis] Erro ao aplicar emoji do chat:', err);
      await repaint(interaction, '⚠️ Algo deu errado ao salvar. Tente de novo.', REGISTRY[key].category);
    }
  });

  return undefined;
}

function handleCancel(interaction, category) {
  captures.get(interaction.message.id)?.stop('cancelado');
  return redraw(interaction, '↩️ Alteração cancelada.', category);
}

function handleResetAll(interaction, category) {
  captures.get(interaction.message.id)?.stop('cancelado');
  resetGuildEmojis(interaction.guild.id);
  return redraw(interaction, '♻️ Todos os emojis voltaram ao padrão.', category);
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

  // `acao:categoria` — a aba aberta viaja no customId, então o painel sobrevive
  // a um restart do bot sem perder de vista onde o usuário estava.
  const [action, rawCategory = ''] = interaction.customId.slice(PREFIX.length).split(':');
  const category = safeCategory(rawCategory);

  if (action === 'cat') return redraw(interaction, '', interaction.values[0]);
  if (action === 'pick') {
    const key = interaction.values[0];
    if (!Object.hasOwn(REGISTRY, key)) return redraw(interaction, '⚠️ Esse emoji não existe mais.', category);
    return startCapture(interaction, key);
  }
  if (action === 'cancel') return handleCancel(interaction, category);
  if (action === 'resetall') return handleResetAll(interaction, category);
  if (action === 'close') return handleClose(interaction);
  return undefined;
}

module.exports = { PREFIX, CAPTURE_MS, DEFAULT_CATEGORY, buildEmojiPanel, isAllowed, routeEmojiConfig };
