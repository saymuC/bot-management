const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const { db, getGuildConfig } = require('../database/db');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { logEvent } = require('../utils/logger');
const { colors, ticket: ticketSettings } = require('../config/settings');

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
  claim: db.prepare('UPDATE tickets SET claimed_by = ? WHERE id = ?'),
  close: db.prepare(
    "UPDATE tickets SET status = 'closed', closed_at = CURRENT_TIMESTAMP WHERE id = ?"
  ),
};

/** Botão inicial do painel de tickets. */
function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('Abrir Ticket')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

/** Clique em "Abrir Ticket" → mostra select de categorias. */
async function handleOpenButton(interaction) {
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
        emoji: cat.emoji || '🎫',
      }))
    );

  return interaction.reply({
    embeds: [baseEmbed({ title: '🎫 Abrir Ticket', description: 'Escolha a categoria do seu atendimento:' })],
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

  const openCount = stmts.openCount.get(interaction.guild.id, interaction.user.id).n;
  if (openCount >= ticketSettings.maxOpenPerUser) {
    return interaction.update({
      embeds: [errorEmbed(`Você já tem ${openCount} tickets abertos. Feche um antes de abrir outro.`)],
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
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketId}`)
      .setLabel('Fechar')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  const mention = category.support_role_id ? `<@&${category.support_role_id}>` : '';
  await channel.send({
    content: `${interaction.user} ${mention}`.trim(),
    embeds: [
      baseEmbed({
        title: `${category.emoji || '🎫'} ${category.label} — Ticket #${ticketId}`,
        description:
          'Descreva seu problema com o máximo de detalhes.\nA equipe de suporte irá te atender em breve.',
        footer: `Aberto por ${interaction.user.tag}`,
      }),
    ],
    components: [buttons],
  });

  await logEvent(
    interaction.guild,
    '🎫 Ticket aberto',
    `Ticket #${ticketId} (**${category.label}**) aberto por ${interaction.user} em ${channel}.`,
    colors.info
  );

  return interaction.editReply({
    embeds: [successEmbed(`Seu ticket foi criado: ${channel}`)],
    components: [],
  });
}

/** Botão "Reivindicar". */
async function handleClaim(interaction, ticketId) {
  const ticket = stmts.ticketByChannel.get(interaction.channel.id);
  if (!ticket || ticket.id !== Number(ticketId)) {
    return interaction.reply({ embeds: [errorEmbed('Ticket não encontrado ou já fechado.')], flags: MessageFlags.Ephemeral });
  }
  if (ticket.claimed_by) {
    return interaction.reply({
      embeds: [errorEmbed(`Este ticket já foi reivindicado por <@${ticket.claimed_by}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  stmts.claim.run(interaction.user.id, ticket.id);
  return interaction.reply({
    embeds: [successEmbed(`${interaction.user} reivindicou este ticket e será o responsável pelo atendimento.`, '🙋 Ticket reivindicado')],
  });
}

/** Botão "Fechar": gera transcript, envia pro log e deleta o canal. */
async function handleClose(interaction, ticketId) {
  const ticket = stmts.ticketByChannel.get(interaction.channel.id);
  if (!ticket || ticket.id !== Number(ticketId)) {
    return interaction.reply({ embeds: [errorEmbed('Ticket não encontrado ou já fechado.')], flags: MessageFlags.Ephemeral });
  }

  await interaction.reply({
    embeds: [baseEmbed({ title: '🔒 Fechando ticket', description: 'Gerando transcript e arquivando em 5 segundos...', color: colors.warning })],
  });

  stmts.close.run(ticket.id);

  // transcript simples em .txt (últimas 100 mensagens)
  let transcriptFile = null;
  try {
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const lines = [...messages.values()]
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content || '[embed/anexo]'}`);
    transcriptFile = new AttachmentBuilder(
      Buffer.from(lines.join('\n'), 'utf-8'),
      { name: `ticket-${ticket.id}-transcript.txt` }
    );
  } catch (err) {
    console.error('[tickets] Falha ao gerar transcript:', err.message);
  }

  const config = getGuildConfig(interaction.guild.id);
  if (config?.log_channel_id) {
    const logChannel = await interaction.guild.channels.fetch(config.log_channel_id).catch(() => null);
    if (logChannel?.isTextBased()) {
      await logChannel
        .send({
          embeds: [
            baseEmbed({
              title: '🔒 Ticket fechado',
              description: `Ticket #${ticket.id} (**${ticket.category_label}**) de <@${ticket.user_id}> fechado por ${interaction.user}.`,
              color: colors.warning,
            }),
          ],
          files: transcriptFile ? [transcriptFile] : [],
        })
        .catch((err) => console.error('[tickets] Falha ao enviar transcript:', err.message));
    }
  }

  setTimeout(() => {
    interaction.channel.delete(`Ticket #${ticket.id} fechado por ${interaction.user.tag}`).catch(() => {});
  }, 5000);
}

/** Roteia interações de ticket pelo prefixo do customId. */
async function routeTicketInteraction(interaction) {
  const { customId } = interaction;
  if (customId === 'ticket_open') return handleOpenButton(interaction);
  if (customId === 'ticket_select_category') return handleCategorySelect(interaction);
  if (customId.startsWith('ticket_claim_')) return handleClaim(interaction, customId.slice('ticket_claim_'.length));
  if (customId.startsWith('ticket_close_')) return handleClose(interaction, customId.slice('ticket_close_'.length));
  return null;
}

module.exports = { buildPanelComponents, routeTicketInteraction };
