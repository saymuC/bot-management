const { Events, MessageFlags } = require('discord.js');
const { routeTicketInteraction } = require('../handlers/ticketHandler');
const { handleEntryButton } = require('../handlers/giveawayHandler');
const { handleStatsPagination } = require('../handlers/ticketStatsHandler');
const { routeEmbedInteraction } = require('../handlers/embedHandler');
const { routeWelcomeSetup } = require('../handlers/welcomeSetupHandler');
const { routeBotStatus } = require('../handlers/botStatusHandler');
const { routeEmojiConfig } = require('../handlers/emojiConfigHandler');
const { routeVerifyInteraction } = require('../handlers/verifyHandler');
const { routeVerifySetup } = require('../handlers/verifySetupHandler');
const { routeAutomodSetup } = require('../handlers/automodSetupHandler');
const { routeLevelsSetup } = require('../handlers/levelsSetupHandler');
const { handleTopPagination } = require('../handlers/levelsLeaderboardHandler');
const { db } = require('../database/db');
const { errorEmbed, successEmbed } = require('../utils/embeds');
const { respond } = require('../utils/interactions');
const { isAckFailure, logAckFailure } = require('../utils/interactionAck');

const reactionRoleStmt = db.prepare('SELECT * FROM reaction_roles WHERE id = ?');

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
        //
        // `defer: false` é a exceção para comandos que respondem de imediato: o
        // defer custa uma ida-e-volta REST inteira antes da resposta aparecer,
        // então quem não faz I/O antes de responder economiza esse tempo todo.
        if (command.defer !== false) {
          await interaction.deferReply(command.ephemeral === false ? {} : { flags: MessageFlags.Ephemeral });
        }
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
      // Painel do /setup-welcome: também abre modais e gerencia o próprio ack.
      if (customId.startsWith('wsetup_')) {
        await routeWelcomeSetup(interaction);
        return;
      }
      // Painel do /bot-status: rascunho + confirmação, também com modais.
      if (customId.startsWith('bstatus_')) {
        await routeBotStatus(interaction);
        return;
      }
      // Painel do /config-emojis: o select entra em modo de escuta do chat e
      // responde depois pelo editReply, então cuida do próprio ack.
      if (customId.startsWith('cfgemoji_')) {
        await routeEmojiConfig(interaction);
        return;
      }
      // Painel do /automod: selects, modais de limites e escada — próprio ack.
      if (customId.startsWith('amod_')) {
        await routeAutomodSetup(interaction);
        return;
      }
      // Paginação do /top: pública e sem defer, só edita a própria mensagem.
      // Precisa vir antes de `lvl_` — não colide (`lvlt` ≠ `lvl_`), mas a ordem
      // deixa explícito que a listagem pública não passa pelo gate de admin.
      if (customId.startsWith('lvltop_')) {
        await handleTopPagination(interaction, customId.slice('lvltop_'.length));
        return;
      }
      // Painel do /levelconfig: modais de XP e recompensas — próprio ack.
      if (customId.startsWith('lvl_')) {
        await routeLevelsSetup(interaction);
        return;
      }
      if (customId.startsWith('giveaway_enter_')) {
        await handleEntryButton(interaction, customId.slice('giveaway_enter_'.length));
        return;
      }
      // Painel do /setup-verify: selects, modais e publicação — próprio ack.
      // Prefixo distinto de `verify_` para não capturar o painel público.
      if (customId.startsWith('vsetup_')) {
        await routeVerifySetup(interaction);
        return;
      }
      // Verificação por captcha: o botão "Inserir código" abre um modal, então o
      // handler cuida do próprio ack.
      if (customId.startsWith('verify_')) {
        await routeVerifyInteraction(interaction);
        return;
      }
      if (customId.startsWith('rr_')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await handleRoleButton(interaction, customId.slice('rr_'.length));
        return;
      }
    } catch (err) {
      // Token morto ou clique já respondido: não há canal de resposta válido,
      // então o aviso (com a idade da interação, que aponta a causa) é o fim da linha.
      if (isAckFailure(err)) {
        logAckFailure('interactionCreate', interaction, err);
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
