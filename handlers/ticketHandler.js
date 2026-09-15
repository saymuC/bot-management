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
const { db } = require('../database/db');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { fetchChannelHistory, buildHtmlTranscript } = require('../utils/transcript');
const { durationBetween, formatDuration, parseSqlDate } = require('../utils/time');
const { colors } = require('../config/settings');
const { emoji } = require('../utils/emojis');
const { getTicketConfig, resolveTicketLogChannelId } = require('../utils/tickets/config');
const { buildTicketPanelComponents } = require('../utils/tickets/panel');
const { isTicketStaff, isTicketManager } = require('../utils/tickets/permissions');

const stmts = {
  categories: db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ?'),
  categoryById: db.prepare('SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?'),
  openCount: db.prepare(
    "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'"
  ),
  insertTicket: db.prepare(
    'INSERT INTO tickets (guild_id, channel_id, user_id, category_label) VALUES (?, ?, ?, ?)'
  ),
  // `user_closed` também está vivo: o canal continua no servidor e a equipe
  // ainda decide entre reabrir e encerrar.
  ticketByChannel: db.prepare(
    "SELECT * FROM tickets WHERE channel_id = ? AND status IN ('open', 'user_closed')"
  ),
  ticketById: db.prepare('SELECT * FROM tickets WHERE id = ?'),
  claim: db.prepare('UPDATE tickets SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ?'),
  softClose: db.prepare(
    "UPDATE tickets SET status = 'user_closed', user_closed_at = CURRENT_TIMESTAMP WHERE id = ?"
  ),
  reopen: db.prepare(
    "UPDATE tickets SET status = 'open', user_closed_at = NULL, reopened_at = CURRENT_TIMESTAMP WHERE id = ?"
  ),
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
 * Botão inicial do painel de tickets, com o rótulo e o emoji configurados.
 * @param {import('discord.js').Guild} guild dono do painel
 */
function buildPanelComponents(guild) {
  return buildTicketPanelComponents(guild, getTicketConfig(guild.id));
}

/**
 * Canal de logs de tickets. Cai no canal de logs geral quando o específico
 * não está configurado, para não perder transcripts em servidores antigos.
 */
async function resolveTicketLogChannel(guild) {
  const channelId = resolveTicketLogChannelId(guild.id);
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

/** Clique em "Abrir Ticket" → valida o limite de tickets abertos e mostra o select. */
async function handleOpenButton(interaction) {
  const config = getTicketConfig(interaction.guild.id);

  // Painel publicado continua no canal depois de desligar o sistema: a recusa
  // acontece aqui, no clique, e não ao apagar mensagem de ninguém.
  if (!config.enabled) {
    return interaction.reply({
      embeds: [errorEmbed('O sistema de tickets está desativado neste servidor.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  // O limite é checado aqui, antes de escolher categoria: evita o usuário
  // percorrer o fluxo inteiro para só então descobrir que está no limite.
  const openCount = stmts.openCount.get(interaction.guild.id, interaction.user.id).n;
  if (openCount >= config.maxOpenPerUser) {
    return interaction.reply({
      embeds: [
        errorEmbed(
          `Você já tem **${openCount}** ticket(s) aberto(s), o máximo permitido é **${config.maxOpenPerUser}**.\n` +
            'Feche um dos tickets em andamento antes de abrir outro.'
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const categories = stmts.categories.all(interaction.guild.id);
  if (!categories.length) {
    return interaction.reply({
      embeds: [errorEmbed('Nenhuma categoria de ticket configurada. Um admin deve usar `/ticket-config`.')],
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

  const config = getTicketConfig(interaction.guild.id);
  const parentId = category.target_category_id || config.defaultParentCategoryId || null;

  // O cargo da categoria e os cargos gerais de atendimento entram no mesmo
  // conjunto: id repetido em dois overwrites é recusado pelo Discord.
  const staffRoleIds = [
    ...new Set([category.support_role_id, ...config.permissions.staffRoleIds].filter(Boolean)),
  ];

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
    ...staffRoleIds.map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    })),
  ];

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

  const mention =
    config.behavior.pingSupportRole && category.support_role_id ? `<@&${category.support_role_id}>` : '';
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

/** Recusa curta e efêmera — o canal do ticket não precisa do registro. */
const refuse = (interaction, text) =>
  interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral });

/**
 * Ticket vivo do canal, ou `null` (já respondendo a recusa).
 *
 * O id vem do `customId` do botão, que fica no canal para sempre: conferir
 * contra o ticket do canal impede que um botão de um ticket antigo, ainda
 * clicável numa mensagem antiga, atue no ticket atual.
 */
async function loadTicket(interaction, ticketId) {
  const ticket = stmts.ticketByChannel.get(interaction.channel.id);
  if (!ticket || ticket.id !== Number(ticketId)) {
    await refuse(interaction, 'Ticket não encontrado ou já encerrado.');
    return null;
  }
  return ticket;
}

/** Botão "Reivindicar" — exclusivo da equipe, o autor do ticket não pode assumir. */
async function handleClaim(interaction, ticketId) {
  const ticket = await loadTicket(interaction, ticketId);
  if (!ticket) return undefined;

  const config = getTicketConfig(interaction.guild.id);
  if (!isTicketStaff(interaction.member, config)) {
    return refuse(interaction, 'Só a equipe de atendimento pode reivindicar tickets.');
  }
  // Vale também para quem é da equipe: autoatendimento falsearia as estatísticas.
  if (ticket.user_id === interaction.user.id) {
    return refuse(interaction, 'Você abriu este ticket, então não pode reivindicá-lo.');
  }
  if (ticket.claimed_by) {
    return refuse(interaction, `Este ticket já foi reivindicado por <@${ticket.claimed_by}>.`);
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

/**
 * Transcript HTML do canal, ou `null` se falhar.
 *
 * A falha não interrompe o fechamento: o ticket já está fechado no banco, e um
 * canal que não desaparece porque o histórico não foi lido é pior que um log sem
 * anexo.
 */
async function buildTranscriptFile(interaction, closed, handlingMs) {
  try {
    const messages = await fetchChannelHistory(interaction.channel);
    const tagOf = async (userId) =>
      `${(await interaction.client.users.fetch(userId).catch(() => null))?.tag ?? userId} (${userId})`;

    return buildHtmlTranscript({
      ticket: closed,
      messages,
      details: {
        Servidor: interaction.guild.name,
        Canal: `#${interaction.channel.name}`,
        Autor: await tagOf(closed.user_id),
        Atendente: closed.claimed_by ? await tagOf(closed.claimed_by) : 'Não reivindicado',
        'Fechado por': `${interaction.user.tag} (${interaction.user.id})`,
        Aberto: `${closed.created_at} UTC`,
        Fechado: `${closed.closed_at} UTC`,
        'Tempo de atendimento': formatDuration(handlingMs),
      },
    });
  } catch (err) {
    console.error('[tickets] Falha ao gerar transcript:', err.message);
    return null;
  }
}

/** Permissões que o autor tem no canal do próprio ticket. */
const AUTHOR_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
];

/**
 * O autor fecha o próprio lado: sai do canal, que continua vivo para a equipe.
 *
 * Não é o fim do ticket — sem isto, um usuário impaciente apagaria o canal (e o
 * transcript) antes de a equipe ler o caso. A equipe decide entre reabrir e
 * encerrar de vez.
 */
async function handleSoftClose(interaction, ticket, config) {
  stmts.softClose.run(ticket.id);

  // Efêmero: em um instante ele deixa de ver o canal, e uma resposta pública
  // ali não chegaria a ele.
  await interaction.reply({
    embeds: [
      successEmbed(
        'Você encerrou o seu lado do atendimento e saiu do canal.\n' +
          'A equipe ainda pode revisar o caso e reabrir o ticket se precisar falar com você.',
        `${emoji(interaction.guild, 'ticket_close')} Ticket fechado`
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });

  await interaction.channel.permissionOverwrites
    .delete(ticket.user_id, `Ticket #${ticket.id} fechado pelo autor`)
    .catch((err) => console.error('[tickets] Falha ao remover o autor do canal:', err.message));

  const actions = new ActionRowBuilder().addComponents(
    [
      config.behavior.allowReopen
        ? new ButtonBuilder()
            .setCustomId(`ticket_reopen_${ticket.id}`)
            .setLabel('Reabrir')
            .setEmoji('🔓')
            .setStyle(ButtonStyle.Success)
        : null,
      new ButtonBuilder()
        .setCustomId(`ticket_close_${ticket.id}`)
        .setLabel('Encerrar e apagar')
        .setEmoji(emoji(interaction.guild, 'ticket_close'))
        .setStyle(ButtonStyle.Danger),
    ].filter(Boolean)
  );

  await interaction.channel
    .send({
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'ticket_close')} O autor encerrou o atendimento`,
          description:
            `<@${ticket.user_id}> fechou o próprio lado do ticket **#${ticket.id}** e não vê mais este canal.\n` +
            'O canal continua aqui para a equipe: **reabra** para voltar a falar com o autor ou ' +
            '**encerre** para gerar o transcript e apagar o canal.',
          color: colors.warning,
        }),
      ],
      components: [actions],
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('[tickets] Falha ao avisar o fechamento pelo autor:', err.message));

  const logChannel = await resolveTicketLogChannel(interaction.guild);
  await logChannel
    ?.send({
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'ticket_close')} Ticket fechado pelo autor`,
          description: `Ticket **#${ticket.id}** (**${ticket.category_label}**) em ${interaction.channel}.`,
          color: colors.warning,
          fields: [
            { name: 'Autor', value: `<@${ticket.user_id}>`, inline: true },
            {
              name: 'Atendente',
              value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : 'Não reivindicado',
              inline: true,
            },
            {
              name: 'Tempo aberto',
              value: formatDuration(Date.now() - (parseSqlDate(ticket.created_at)?.getTime() ?? Date.now())),
              inline: true,
            },
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('[tickets] Falha ao logar fechamento pelo autor:', err.message));

  return undefined;
}

/** Botão "Reabrir": devolve o autor ao canal de um ticket que ele havia fechado. */
async function handleReopen(interaction, ticketId) {
  const ticket = await loadTicket(interaction, ticketId);
  if (!ticket) return undefined;

  const config = getTicketConfig(interaction.guild.id);
  if (!isTicketStaff(interaction.member, config)) {
    return refuse(interaction, 'Só a equipe de atendimento pode reabrir tickets.');
  }
  if (ticket.status !== 'user_closed') {
    return refuse(interaction, 'Este ticket já está aberto.');
  }
  // O botão sobrevive ao desligamento da reabertura na configuração.
  if (!config.behavior.allowReopen) {
    return refuse(interaction, 'A reabertura de tickets está desativada neste servidor.');
  }

  try {
    await interaction.channel.permissionOverwrites.edit(
      ticket.user_id,
      Object.fromEntries(AUTHOR_ALLOW.map((flag) => [flag, true])),
      { reason: `Ticket #${ticket.id} reaberto por ${interaction.user.tag}` }
    );
  } catch (err) {
    // Sem o autor de volta no canal, reabrir não significa nada: o banco fica
    // como está e a equipe vê o motivo.
    console.error('[tickets] Falha ao devolver o autor ao canal:', err.message);
    return refuse(interaction, 'Não consegui devolver o autor ao canal. Verifique minhas permissões aqui.');
  }

  stmts.reopen.run(ticket.id);

  await interaction.reply({
    content: `<@${ticket.user_id}>`,
    embeds: [
      successEmbed(
        `${interaction.user} reabriu este ticket. <@${ticket.user_id}> voltou ao canal e pode responder.`,
        '🔓 Ticket reaberto'
      ),
    ],
  });

  const logChannel = await resolveTicketLogChannel(interaction.guild);
  await logChannel
    ?.send({
      embeds: [
        baseEmbed({
          title: '🔓 Ticket reaberto',
          description: `Ticket **#${ticket.id}** (**${ticket.category_label}**) em ${interaction.channel}.`,
          color: colors.info,
          fields: [
            { name: 'Reaberto por', value: `${interaction.user}`, inline: true },
            { name: 'Autor', value: `<@${ticket.user_id}>`, inline: true },
          ],
        }),
      ],
      allowedMentions: { parse: [] },
    })
    .catch((err) => console.error('[tickets] Falha ao logar reabertura:', err.message));

  return undefined;
}

/**
 * Botão "Fechar" — decide pelo clicante.
 *
 * O mesmo `customId` serve o autor e a equipe porque as mensagens de ticket já
 * publicadas nos canais continuam válidas: quem abriu fecha o próprio lado, a
 * gerência encerra de vez, gera transcript, pede avaliação e apaga o canal.
 */
async function handleClose(interaction, ticketId) {
  const ticket = await loadTicket(interaction, ticketId);
  if (!ticket) return undefined;

  const config = getTicketConfig(interaction.guild.id);

  if (!isTicketManager(interaction.member, config)) {
    if (ticket.user_id !== interaction.user.id) {
      return refuse(interaction, 'Encerrar e apagar um ticket é restrito à gerência.');
    }
    if (!config.permissions.allowUserSoftClose) {
      return refuse(interaction, 'Só a equipe pode fechar este ticket. Aguarde o atendimento.');
    }
    if (ticket.status === 'user_closed') {
      return refuse(interaction, 'Você já fechou o seu lado deste atendimento.');
    }
    return handleSoftClose(interaction, ticket, config);
  }

  if (config.permissions.requireClaimBeforeFinalClose && !ticket.claimed_by) {
    return refuse(
      interaction,
      'Este ticket precisa ser reivindicado antes de ser encerrado — clique em **Reivindicar** primeiro.'
    );
  }

  const delayMs = config.behavior.deleteDelaySeconds * 1000;

  await interaction.reply({
    embeds: [
      baseEmbed({
        title: `${emoji(interaction.guild, 'ticket_close')} Fechando ticket`,
        description: `Arquivando este canal em ${config.behavior.deleteDelaySeconds} segundo(s)...`,
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

  // Ler o histórico inteiro do canal é a parte cara do fechamento; sem
  // transcript, ela nem começa.
  const transcript = config.behavior.createTranscript
    ? await buildTranscriptFile(interaction, closed, handlingMs)
    : null;

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
  if (config.behavior.sendRatingDm && closed.claimed_by) {
    const author = await interaction.client.users.fetch(closed.user_id).catch(() => null);
    await author
      ?.send(buildRatingRequest(closed, interaction.guild))
      .catch(() => console.log(`[tickets] DM de avaliação bloqueada pelo usuário ${closed.user_id}.`));
  }

  setTimeout(() => {
    interaction.channel.delete(`Ticket #${closed.id} fechado por ${interaction.user.tag}`).catch(() => {});
  }, delayMs);
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
  if (customId.startsWith('ticket_reopen_')) return handleReopen(interaction, customId.slice('ticket_reopen_'.length));
  if (customId.startsWith('ticket_ratemodal_')) return handleRatingModal(interaction, customId.slice('ticket_ratemodal_'.length));
  if (customId.startsWith('ticket_rate_')) return handleRatingButton(interaction, customId.slice('ticket_rate_'.length));
  return null;
}

module.exports = { buildPanelComponents, routeTicketInteraction, STAR_LABELS };
