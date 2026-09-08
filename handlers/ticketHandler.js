const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { db, getGuildConfig } = require('../database/db');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { fetchChannelHistory, buildHtmlTranscript } = require('../utils/transcript');
const { durationBetween, formatDuration, parseSqlDate } = require('../utils/time');
const { colors, ticket: ticketSettings } = require('../config/settings');
const { emoji } = require('../utils/emojis');

const stmts = {
  categories: db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ?'),
  categoryById: db.prepare('SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?'),
  openCount: db.prepare(
    "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'"
  ),
  insertTicket: db.prepare(
    'INSERT INTO tickets (guild_id, channel_id, user_id, category_label) VALUES (?, ?, ?, ?)'
  ),
  ticketByChannel: db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'"),
  ticketById: db.prepare('SELECT * FROM tickets WHERE id = ?'),
  claim: db.prepare('UPDATE tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?'),
  close: db.prepare(
    "UPDATE tickets SET status = 'closed', closed_by = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?"
  ),
  ratingByTicket: db.prepare('SELECT * FROM ticket_ratings WHERE ticket_id = ?'),
  insertRating: db.prepare(
    'INSERT INTO ticket_ratings (guild_id, ticket_id, agent_id, user_id, stars, comment) VALUES (?, ?, ?, ?, ?, ?)'
  ),
};

const STAR_LABELS = {
  1: 'Muito ruim',
  2: 'Ruim',
  3: 'Regular',
  4: 'Bom',
  5: 'Excelente',
};

/**
 * Botão inicial do painel de tickets.
 * @param {import('discord.js').Guild} guild dono do painel — define o emoji usado
 */
function buildPanelComponents(guild) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('Abrir Ticket')
        .setEmoji(emoji(guild, 'ticket'))
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

/**
 * Canal de logs de tickets. Cai no canal de logs geral quando o específico
 * não está configurado, para não perder transcripts em servidores antigos.
 */
async function resolveTicketLogChannel(guild) {
  const config = getGuildConfig(guild.id);
  const channelId = config?.ticket_log_channel_id || config?.log_channel_id;
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

/** Clique em "Abrir Ticket" → valida o limite de tickets abertos e mostra o select. */
async function handleOpenButton(interaction) {
  // O limite é checado aqui, antes de escolher categoria: evita o usuário
  // percorrer o fluxo inteiro para só então descobrir que está no limite.
  const openCount = stmts.openCount.get(interaction.guild.id, interaction.user.id).n;
  if (openCount >= ticketSettings.maxOpenPerUser) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          `Você já tem **${openCount}** ticket(s) aberto(s), o máximo permitido é **${ticketSettings.maxOpenPerUser}**.\n` +
            'Feche um dos tickets em andamento antes de abrir outro.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const categories = stmts.categories.all(interaction.guild.id);
  if (!categories.length) {
    return interaction.reply({
      embeds: [errorEmbed('Nenhuma categoria de ticket configurada. Um admin deve usar `/ticket-add-category`.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_select_category')
    .setPlaceholder('Selecione o tipo de atendimento')
    .addOptions(
      categories.slice(0, 25).map((cat) => ({
        label: cat.label,
        value: String(cat.id),
        emoji: cat.emoji || emoji(interaction.guild, 'ticket'),
      }))
    );

  return interaction.reply({
    embeds: [
      baseEmbed({
        title: `${emoji(interaction.guild, 'ticket')} Abrir Ticket`,
        description: 'Escolha a categoria do seu atendimento:',
      }),
    ],
    components: [new ActionRowBuilder().addComponents(menu)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Seleção de categoria → cria o canal do ticket. */
async function handleCategorySelect(interaction) {
  const category = stmts.categoryById.get(Number(interaction.values[0]), interaction.guild.id);
  if (!category) {
    return interaction.update({
      embeds: [errorEmbed('Categoria não encontrada. Ela pode ter sido removida.')],
      components: [],
    });
  }

  await interaction.deferUpdate();

  const config = getGuildConfig(interaction.guild.id);
  const parentId = category.target_category_id || config?.ticket_category_id || null;

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];
  if (category.support_role_id) {
    overwrites.push({
      id: category.support_role_id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const slug = category.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
  let channel;
  try {
    channel = await interaction.guild.channels.create({
      name: `ticket-${slug}-${interaction.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: parentId ?? undefined,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    console.error('[tickets] Falha ao criar canal:', err);
    return interaction.editReply({
      embeds: [errorEmbed('Não consegui criar o canal do ticket. Verifique minhas permissões e a categoria configurada.')],
      components: [],
    });
  }

  const result = stmts.insertTicket.run(
    interaction.guild.id, channel.id, interaction.user.id, category.label
  );
  const ticketId = result.lastInsertRowid;

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim_${ticketId}`)
      .setLabel('Reivindicar')
      .setEmoji(emoji(interaction.guild, 'ticket_claim'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketId}`)
      .setLabel('Fechar')
      .setEmoji(emoji(interaction.guild, 'ticket_close'))
      .setStyle(ButtonStyle.Danger)
  );

  const mention = category.support_role_id ? `<@&${category.support_role_id}>` : '';
  await channel.send({
    content: `${interaction.user} ${mention}`.trim(),
    embeds: [
      baseEmbed({
        title: `${category.emoji || emoji(interaction.guild, 'ticket')} ${category.label} — Ticket #${ticketId}`,
        description:
          'Descreva seu problema com o máximo de detalhes.\nA equipe de suporte irá te atender em breve.',
        footer: `Aberto por ${interaction.user.tag}`,
      }),
    ],
    components: [buttons],
  });

  const logChannel = await resolveTicketLogChannel(interaction.guild);
  await logChannel
    ?.send({
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'ticket')} Ticket aberto`,
          description: `Ticket **#${ticketId}** (**${category.label}**) aberto por ${interaction.user} em ${channel}.`,
          color: colors.info,
          fields: [{ name: 'Autor', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true }],
        }),
      ],
    })
    .catch((err) => console.error('[tickets] Falha ao logar abertura:', err.message));

  return interaction.editReply({
    embeds: [successEmbed(`Seu ticket foi criado: ${channel}`)],
    components: [],
  });
}

/** Botão "Reivindicar" — exclusivo da equipe, o autor do ticket não pode assumir. */
async function handleClaim(interaction, ticketId) {
  const ticket = stmts.ticketByChannel.get(interaction.channel.id);
  if (!ticket || ticket.id !== Number(ticketId)) {
    return interaction.reply({ embeds: [errorEmbed('Ticket não encontrado ou já fechado.')], flags: MessageFlags.Ephemeral });
  }
  if (ticket.user_id === interaction.user.id) {
    return interaction.reply({
      embeds: [errorEmbed('Você abriu este ticket, então não pode reivindicá-lo. Aguarde um atendente da equipe.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (ticket.claimed_by) {
    return interaction.reply({
      embeds: [errorEmbed(`Este ticket já foi reivindicado por <@${ticket.claimed_by}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  stmts.claim.run(interaction.user.id, ticket.id);

  const claimIcon = emoji(interaction.guild, 'ticket_claim');
  await interaction.reply({
    embeds: [
      successEmbed(
        `${interaction.user} reivindicou este ticket e será o responsável pelo atendimento.`,
        `${claimIcon} Ticket reivindicado`
      ),
    ],
  });

  const logChannel = await resolveTicketLogChannel(interaction.guild);
  await logChannel
    ?.send({
      embeds: [
        baseEmbed({
          title: `${claimIcon} Ticket reivindicado`,
          description: `Ticket #${ticket.id} (**${ticket.category_label}**) de <@${ticket.user_id}>.`,
          color: colors.info,
          fields: [
            { name: 'Atendente', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
            {
              name: 'Espera até o atendimento',
              value: formatDuration(Date.now() - (parseSqlDate(ticket.created_at)?.getTime() ?? Date.now())),
              inline: true,
            },
          ],
        }),
      ],
    })
    .catch((err) => console.error('[tickets] Falha ao logar claim:', err.message));
}

/**
 * Monta o pedido de avaliação enviado na DM do autor do ticket.
 * @param {import('discord.js').Guild} guild servidor do ticket — define o emoji das estrelas
 */
function buildRatingRequest(ticket, guild) {
  const star = emoji(guild, 'ticket_rating');

  const buttons = new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((stars) =>
      new ButtonBuilder()
        .setCustomId(`ticket_rate_${ticket.id}_${stars}`)
        .setEmoji(star)
        .setLabel(String(stars))
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return {
    embeds: [
      baseEmbed({
        title: `${star} Avalie seu atendimento`,
        description:
          `Seu ticket **#${ticket.id}** (${ticket.category_label ?? 'sem categoria'}) em **${guild.name}** foi encerrado.\n\n` +
          `Como você avalia o atendimento de <@${ticket.claimed_by}>?\n` +
          'Escolha de 1 a 5 estrelas abaixo — em seguida você poderá deixar um comentário opcional.',
        color: colors.primary,
      }),
    ],
    components: [buttons],
  };
}

/** Botão "Fechar": registra o fechamento, gera transcript HTML, loga e pede avaliação. */
async function handleClose(interaction, ticketId) {
  const ticket = stmts.ticketByChannel.get(interaction.channel.id);
  if (!ticket || ticket.id !== Number(ticketId)) {
    return interaction.reply({ embeds: [errorEmbed('Ticket não encontrado ou já fechado.')], flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({
    embeds: [
      baseEmbed({
        title: `${emoji(interaction.guild, 'ticket_close')} Fechando ticket`,
        description: 'Gerando transcript e arquivando em 5 segundos...',
        color: colors.warning,
      }),
    ],
  });

  stmts.close.run(interaction.user.id, ticket.id);
  const closed = stmts.ticketById.get(ticket.id);

  // KPIs: espera até o primeiro atendimento e duração efetiva do atendimento.
  const waitMs = durationBetween(closed.created_at, closed.claimed_at);
  const handlingMs = durationBetween(closed.claimed_at ?? closed.created_at, closed.closed_at);
  const totalMs = durationBetween(closed.created_at, closed.closed_at);

  let transcript = null;
  try {
    const messages = await fetchChannelHistory(interaction.channel);
    transcript = buildHtmlTranscript({
      ticket: closed,
      messages,
      details: {
        Servidor: interaction.guild.name,
        Canal: `#${interaction.channel.name}`,
        Autor: `${(await interaction.client.users.fetch(closed.user_id).catch(() => null))?.tag ?? closed.user_id} (${closed.user_id})`,
        Atendente: closed.claimed_by
          ? `${(await interaction.client.users.fetch(closed.claimed_by).catch(() => null))?.tag ?? closed.claimed_by} (${closed.claimed_by})`
          : 'Não reivindicado',
        'Fechado por': `${interaction.user.tag} (${interaction.user.id})`,
        Aberto: `${closed.created_at} UTC`,
        Fechado: `${closed.closed_at} UTC`,
        'Tempo de atendimento': formatDuration(handlingMs),
      },
    });
  } catch (err) {
    console.error('[tickets] Falha ao gerar transcript:', err.message);
  }

  const logChannel = await resolveTicketLogChannel(interaction.guild);
  if (logChannel) {
    await logChannel
      .send({
        embeds: [
          baseEmbed({
            title: `${emoji(interaction.guild, 'ticket_close')} Ticket fechado`,
            description: `Ticket **#${closed.id}** (**${closed.category_label}**) de <@${closed.user_id}>.`,
            color: colors.warning,
            fields: [
              { name: 'Fechado por', value: `${interaction.user}`, inline: true },
              { name: 'Atendente', value: closed.claimed_by ? `<@${closed.claimed_by}>` : 'Não reivindicado', inline: true },
              { name: 'Espera até atender', value: formatDuration(waitMs), inline: true },
              { name: 'Tempo de atendimento', value: formatDuration(handlingMs), inline: true },
              { name: 'Duração total', value: formatDuration(totalMs), inline: true },
              { name: 'Canal', value: `#${interaction.channel.name}`, inline: true },
            ],
          }),
        ],
        files: transcript ? [transcript] : [],
      })
      .catch((err) => console.error('[tickets] Falha ao enviar transcript:', err.message));
  }

  // Avaliação só faz sentido quando há um atendente responsável.
  if (closed.claimed_by) {
    const author = await interaction.client.users.fetch(closed.user_id).catch(() => null);
    await author
      ?.send(buildRatingRequest(closed, interaction.guild))
      .catch(() => console.log(`[tickets] DM de avaliação bloqueada pelo usuário ${closed.user_id}.`));
  }

  setTimeout(() => {
    interaction.channel.delete(`Ticket #${closed.id} fechado por ${interaction.user.tag}`).catch(() => {});
  }, 5000);
}

/** Clique numa estrela na DM → abre o modal de comentário opcional. */
async function handleRatingButton(interaction, payload) {
  const [rawTicketId, rawStars] = payload.split('_');
  const ticket = stmts.ticketById.get(Number(rawTicketId));
  const stars = Number(rawStars);

  if (!ticket || ticket.user_id !== interaction.user.id) {
    return interaction.reply({ embeds: [errorEmbed('Não encontrei este atendimento.')], flags: MessageFlags.Ephemeral });
  }
  if (stmts.ratingByTicket.get(ticket.id)) {
    return interaction.reply({
      embeds: [errorEmbed('Você já avaliou este atendimento. Obrigado!')],
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket_ratemodal_${ticket.id}_${stars}`)
    .setTitle(`Avaliação: ${stars} estrela${stars > 1 ? 's' : ''}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('comment')
          .setLabel('Quer comentar algo sobre o atendimento?')
          .setPlaceholder('Opcional — conte o que foi bom ou o que podemos melhorar.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false)
      )
    );

  return interaction.showModal(modal);
}

/** Envio do modal → grava a avaliação e credita o atendente. */
async function handleRatingModal(interaction, payload) {
  const [rawTicketId, rawStars] = payload.split('_');
  const ticket = stmts.ticketById.get(Number(rawTicketId));
  const stars = Number(rawStars);

  if (!ticket || ticket.user_id !== interaction.user.id || !ticket.claimed_by) {
    return interaction.reply({ embeds: [errorEmbed('Não encontrei este atendimento.')], flags: MessageFlags.Ephemeral });
  }

  const comment = interaction.fields.getTextInputValue('comment').trim() || null;
  // A DM não tem guild na interação; o id do ticket é o que liga a avaliação ao servidor.
  const star = emoji(ticket.guild_id, 'ticket_rating');

  try {
    stmts.insertRating.run(ticket.guild_id, ticket.id, ticket.claimed_by, interaction.user.id, stars, comment);
  } catch (err) {
    // UNIQUE(ticket_id): corrida entre dois cliques na mesma DM.
    console.error('[tickets] Falha ao registrar avaliação:', err.message);
    return interaction.reply({
      embeds: [errorEmbed('Este atendimento já possui uma avaliação registrada.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    embeds: [
      successEmbed(
        `Avaliação registrada: ${star.repeat(stars)} (${STAR_LABELS[stars]}).\n` +
          (comment ? 'Seu comentário foi enviado à equipe.' : 'Obrigado pelo retorno!'),
        `${star} Obrigado pela avaliação`
      ),
    ],
  });

  // Remove os botões da DM para não permitir novo clique.
  await interaction.message?.edit({ components: [] }).catch(() => {});

  const guild = await interaction.client.guilds.fetch(ticket.guild_id).catch(() => null);
  if (!guild) return;

  const logChannel = await resolveTicketLogChannel(guild);
  await logChannel
    ?.send({
      embeds: [
        baseEmbed({
          title: `${star} Atendimento avaliado`,
          description: `Ticket **#${ticket.id}** (**${ticket.category_label}**) avaliado por <@${ticket.user_id}>.`,
          color: stars >= 4 ? colors.success : stars <= 2 ? colors.error : colors.warning,
          fields: [
            { name: 'Atendente', value: `<@${ticket.claimed_by}>`, inline: true },
            { name: 'Nota', value: `${star.repeat(stars)} ${stars}/5 — ${STAR_LABELS[stars]}`, inline: true },
            { name: 'Comentário', value: comment ?? '*sem comentário*', inline: false },
          ],
        }),
      ],
    })
    .catch((err) => console.error('[tickets] Falha ao logar avaliação:', err.message));
}

/** Roteia interações de ticket pelo prefixo do customId. */
async function routeTicketInteraction(interaction) {
  const { customId } = interaction;
  if (customId === 'ticket_open') return handleOpenButton(interaction);
  if (customId === 'ticket_select_category') return handleCategorySelect(interaction);
  if (customId.startsWith('ticket_claim_')) return handleClaim(interaction, customId.slice('ticket_claim_'.length));
  if (customId.startsWith('ticket_close_')) return handleClose(interaction, customId.slice('ticket_close_'.length));
  if (customId.startsWith('ticket_ratemodal_')) return handleRatingModal(interaction, customId.slice('ticket_ratemodal_'.length));
  if (customId.startsWith('ticket_rate_')) return handleRatingButton(interaction, customId.slice('ticket_rate_'.length));
  return null;
}

module.exports = { buildPanelComponents, routeTicketInteraction, STAR_LABELS };
