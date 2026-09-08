const { Events, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { routeTicketInteraction } = require('../handlers/ticketHandler');
const { handleEntryButton } = require('../handlers/giveawayHandler');
const { handleStatsPagination } = require('../handlers/ticketStatsHandler');
const { routeEmbedInteraction } = require('../handlers/embedHandler');
const { isOAuthEnabled, createOAuthUrl } = require('../oauth/server');
const { db, getGuildConfig } = require('../database/db');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { respond } = require('../utils/interactions');

const reactionRoleStmt = db.prepare('SELECT * FROM reaction_roles WHERE id = ?');

async function handleVerifyButton(interaction) {
  const config = getGuildConfig(interaction.guild.id);
  if (!config?.verify_role_id) {
    return respond(interaction, { embeds: [errorEmbed('Verificação não configurada neste servidor.')] });
  }
  try {
    await interaction.member.roles.add(config.verify_role_id, 'Verificação via botão');

    // se OAuth estiver configurado, oferece também a conexão da conta (guilds.join)
    if (isOAuthEnabled()) {
      return respond(interaction, {
        embeds: [
          successEmbed(
            'Você foi verificado! Bem-vindo(a) ao servidor. 🎉\n\n' +
              'Opcional: conecte sua conta ao bot no botão abaixo para poder ser readicionado automaticamente pela staff.'
          ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Conectar conta').setStyle(ButtonStyle.Link).setURL(createOAuthUrl(interaction.guild.id))
          ),
        ],
      });
    }
    return respond(interaction, { embeds: [successEmbed('Você foi verificado! Bem-vindo(a) ao servidor. 🎉')] });
  } catch (err) {
    console.error('[verify] Falha ao adicionar cargo:', err.message);
    return respond(interaction, {
      embeds: [errorEmbed('Não consegui te dar o cargo. Avise a staff (o cargo do bot precisa estar acima do cargo de verificado).')],
    });
  }
}

/** Toggle do self-role via botão (customId: rr_<id>). */
async function handleRoleButton(interaction, entryId) {
  const entry = reactionRoleStmt.get(Number(entryId));
  if (!entry || entry.guild_id !== interaction.guild.id) {
    return respond(interaction, { embeds: [errorEmbed('Este cargo não está mais configurado.')] });
  }
  try {
    if (interaction.member.roles.cache.has(entry.role_id)) {
      await interaction.member.roles.remove(entry.role_id, 'Self-role (toggle)');
      return respond(interaction, { embeds: [successEmbed(`Cargo <@&${entry.role_id}> removido.`)] });
    }
    await interaction.member.roles.add(entry.role_id, 'Self-role (toggle)');
    return respond(interaction, { embeds: [successEmbed(`Cargo <@&${entry.role_id}> adicionado!`)] });
  } catch (err) {
    console.error('[roles] Falha no toggle de cargo:', err.message);
    return respond(interaction, {
      embeds: [errorEmbed('Não consegui alterar seu cargo. Verifique a hierarquia de cargos do bot.')],
    });
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      // ---- Autocomplete ----
      // Precisa vir antes do defer: autocomplete só aceita interaction.respond().
      if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (!command?.autocomplete) return;
        await command.autocomplete(interaction);
        return;
      }

      // ---- Slash commands ----
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        // Discord fecha a janela de resposta em 3s. Comandos que fazem chamadas REST
        // antes de responder (enviar mensagem, banir, criar canal) estouram esse prazo
        // e geram DiscordAPIError[10062]. O defer reserva a resposta imediatamente;
        // os comandos então usam respond() -> editReply.
        await interaction.deferReply(command.ephemeral === false ? {} : { flags: MessageFlags.Ephemeral });
        await command.execute(interaction);
        return;
      }

      // ---- Botões / selects / modals roteados por customId ----
      const customId = interaction.customId ?? '';

      // O fluxo de tickets gerencia o próprio ack (deferUpdate no select,
      // showModal na avaliação — nenhum dos dois admite deferReply antes).
      if (customId.startsWith('ticket_')) {
        await routeTicketInteraction(interaction);
        return;
      }
      // Paginação do /ticket-stats: edita a própria mensagem, sem defer.
      if (customId.startsWith('tstats_')) {
        await handleStatsPagination(interaction, customId.slice('tstats_'.length));
        return;
      }
      // Preview do /embed: o botão Editar abre um modal, que não admite defer antes.
      if (customId.startsWith('embedp_')) {
        await routeEmbedInteraction(interaction);
        return;
      }
      if (customId.startsWith('giveaway_enter_')) {
        await handleEntryButton(interaction, customId.slice('giveaway_enter_'.length));
        return;
      }
      if (customId === 'verify_button') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await handleVerifyButton(interaction);
        return;
      }
      if (customId.startsWith('rr_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await handleRoleButton(interaction, customId.slice('rr_'.length));
        return;
      }
    } catch (err) {
      // 10062 (Unknown interaction) / 40060 (already acknowledged): o token da
      // interação morreu ou outra instância do bot já respondeu ao mesmo clique.
      // Não há canal de resposta válido — só registra e sai.
      if (err.code === 10062 || err.code === 40060) {
        console.warn(`[interactionCreate] Interação não respondível (${err.code}); ignorada.`);
        return;
      }
      console.error('[interactionCreate] Erro:', err);
      // Autocomplete não tem canal de resposta de erro — só o log acima.
      if (interaction.isAutocomplete?.()) return;
      const payload = { embeds: [errorEmbed('Ocorreu um erro ao processar sua ação.')] };
      if (interaction.deferred) {
        await interaction.editReply(payload).catch(() => {});
      } else if (interaction.replied) {
        await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  },
};
