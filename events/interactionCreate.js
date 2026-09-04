const { Events, MessageFlags } = require('discord.js');
const { routeTicketInteraction } = require('../handlers/ticketHandler');
const { handleEntryButton } = require('../handlers/giveawayHandler');
const { db, getGuildConfig } = require('../database/db');
const { errorEmbed, successEmbed } = require('../utils/embeds');

const reactionRoleStmt = db.prepare('SELECT * FROM reaction_roles WHERE id = ?');

async function handleVerifyButton(interaction) {
  const config = getGuildConfig(interaction.guild.id);
  if (!config?.verify_role_id) {
    return interaction.reply({ embeds: [errorEmbed('Verificação não configurada neste servidor.')], flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.member.roles.add(config.verify_role_id, 'Verificação via botão');

    // se OAuth estiver configurado, oferece também a conexão da conta (guilds.join)
    const { isOAuthEnabled, createOAuthUrl } = require('../oauth/server');
    if (isOAuthEnabled()) {
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      return interaction.reply({
        embeds: [successEmbed(
          'Você foi verificado! Bem-vindo(a) ao servidor. 🎉\n\n' +
          'Opcional: conecte sua conta ao bot no botão abaixo para poder ser readicionado automaticamente pela staff.'
        )],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel('Conectar conta').setStyle(ButtonStyle.Link).setURL(createOAuthUrl(interaction.guild.id))
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
    return interaction.reply({ embeds: [successEmbed('Você foi verificado! Bem-vindo(a) ao servidor. 🎉')], flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[verify] Falha ao adicionar cargo:', err.message);
    return interaction.reply({
      embeds: [errorEmbed('Não consegui te dar o cargo. Avise a staff (o cargo do bot precisa estar acima do cargo de verificado).')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Toggle do self-role via botão (customId: rr_<id>). */
async function handleRoleButton(interaction, entryId) {
  const entry = reactionRoleStmt.get(Number(entryId));
  if (!entry || entry.guild_id !== interaction.guild.id) {
    return interaction.reply({ embeds: [errorEmbed('Este cargo não está mais configurado.')], flags: MessageFlags.Ephemeral });
  }
  try {
    const has = interaction.member.roles.cache.has(entry.role_id);
    if (has) {
      await interaction.member.roles.remove(entry.role_id, 'Self-role (toggle)');
      return interaction.reply({ embeds: [successEmbed(`Cargo <@&${entry.role_id}> removido.`)], flags: MessageFlags.Ephemeral });
    }
    await interaction.member.roles.add(entry.role_id, 'Self-role (toggle)');
    return interaction.reply({ embeds: [successEmbed(`Cargo <@&${entry.role_id}> adicionado!`)], flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[roles] Falha no toggle de cargo:', err.message);
    return interaction.reply({
      embeds: [errorEmbed('Não consegui alterar seu cargo. Verifique a hierarquia de cargos do bot.')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    try {
      // ---- Slash commands ----
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      // ---- Botões / selects / modals roteados por customId ----
      const customId = interaction.customId ?? '';

      if (customId.startsWith('ticket_')) {
        await routeTicketInteraction(interaction);
        return;
      }
      if (customId.startsWith('giveaway_enter_')) {
        await handleEntryButton(interaction, customId.slice('giveaway_enter_'.length));
        return;
      }
      if (customId === 'verify_button') {
        await handleVerifyButton(interaction);
        return;
      }
      if (customId.startsWith('rr_')) {
        await handleRoleButton(interaction, customId.slice('rr_'.length));
        return;
      }
    } catch (err) {
      console.error('[interactionCreate] Erro:', err);
      const payload = { embeds: [errorEmbed('Ocorreu um erro ao processar sua ação.')], flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
