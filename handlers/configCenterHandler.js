const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const { db, getGuildConfig, setGuildConfig } = require('../database/db');
const { homeFor: ticketHomeFor } = require('./ticketSetupHandler');
const { getAutomodConfig } = require('../utils/automod/config');
const { homeFor: automodHomeFor } = require('./automodSetupHandler');
const { getVerifyPanelConfig } = require('../utils/verifyPanelConfig');
const { buildSetupPayload: verifySetupPayload } = require('./verifySetupHandler');
const { getWelcomeConfig } = require('../utils/welcomeConfig');
const { buildPanelPayload: welcomePanelPayload } = require('./welcomeSetupHandler');
const { getLevelsConfig } = require('../utils/levels/config');
const { buildPanelPayload: levelsPanelPayload } = require('./levelsSetupHandler');
const { buildEmojiPanel } = require('./emojiConfigHandler');
const { homePayload: permissionsHomePayload } = require('./permissionsSetupHandler');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { makeSafeAck } = require('../utils/interactionAck');
const { validateAssignableRole } = require('../utils/assignableRoles');
const { canUseCommand, PERMISSION_DENIED_MESSAGE } = require('../utils/commandPermissions');

const PREFIX = 'config_';
const safeAck = makeSafeAck('config-center');
const insertReactionRole = db.prepare(
  'INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)'
);
const setReactionRoleMessageId = db.prepare('UPDATE reaction_roles SET message_id = ? WHERE id = ?');

function centerPayload(guild) {
  return {
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'config_center')} Central de Configuração`,
        description: 'Escolha abaixo qual sistema do servidor você quer configurar.',
        footer: `Servidor: ${guild.name}`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}open`)
          .setPlaceholder('Selecione uma configuração')
          .addOptions([
            {
              label: 'Verificar membros',
              value: 'verify',
              emoji: emoji(guild, 'verify_panel'),
              description: 'Painel de verificação por captcha',
            },
            {
              label: 'Configurar logs',
              value: 'logs',
              emoji: emoji(guild, 'config_logs'),
              description: 'Canal geral de logs do servidor',
            },
            {
              label: 'Sistema de tickets',
              value: 'tickets',
              emoji: emoji(guild, 'ticket'),
              description: 'Painel, categorias, permissões e logs',
            },
            {
              label: 'Proteção automática',
              value: 'automod',
              emoji: emoji(guild, 'automod'),
              description: 'Filtros, punições e isenções do AutoMod',
            },
            {
              label: 'Mensagem de boas-vindas',
              value: 'welcome',
              emoji: emoji(guild, 'welcome'),
              description: 'Canal, texto, embed e teste de entrada',
            },
            {
              label: 'Sistema de níveis',
              value: 'levels',
              emoji: emoji(guild, 'rank'),
              description: 'XP, anúncios, recompensas e aparência',
            },
            {
              label: 'Emojis do bot',
              value: 'emojis',
              emoji: emoji(guild, 'config_emojis'),
              description: 'Troca os emojis usados nas mensagens',
            },
            {
              label: 'Cargo automático',
              value: 'autorole',
              emoji: emoji(guild, 'autorole'),
              description: 'Cargo recebido por novos membros',
            },
            {
              label: 'Permissões de comandos',
              value: 'permissions',
              emoji: emoji(guild, 'config_permissions'),
              description: 'Quais cargos podem usar cada comando',
            },
            {
              label: 'Reaction role',
              value: 'reactionrole',
              emoji: emoji(guild, 'reaction_role'),
              description: 'Mensagem de auto-atribuição de cargo',
            },
          ])
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function autorolePayload(guild) {
  const current = getGuildConfig(guild.id)?.autorole_id;
  return {
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'autorole')} Cargo automático`,
        description: current
          ? `Cargo atual: <@&${current}>\nSelecione outro cargo abaixo ou clique em desativar.`
          : 'Selecione o cargo que novos membros receberão automaticamente.',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${PREFIX}autorole-role`).setPlaceholder('Cargo automático').setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}autorole-clear`)
          .setLabel('Desativar autorole')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!current)
      ),
    ],
  };
}

function reactionRolePayload(guild) {
  return {
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'reaction_role')} Reaction role`,
        description: 'Selecione o cargo. Depois escolha o canal onde a mensagem será publicada.',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${PREFIX}rr-role`).setPlaceholder('Cargo do botão').setMaxValues(1)
      ),
    ],
  };
}

function reactionRoleChannelPayload(guild, role) {
  return {
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'reaction_role')} Reaction role`,
        description: `Cargo escolhido: ${role}\nAgora selecione o canal para publicar a mensagem.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}rr-channel:${role.id}`)
          .setPlaceholder('Canal da mensagem')
          .addChannelTypes(ChannelType.GuildText)
      ),
    ],
  };
}

function logsPayload(guild) {
  return {
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'config_logs')} Configuração de logs`,
        description: 'Selecione o canal de texto que receberá os logs gerais do servidor.',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${PREFIX}logs-channel`)
          .setPlaceholder('Canal de logs')
          .addChannelTypes(ChannelType.GuildText)
      ),
    ],
  };
}

function selectedPanel(interaction, selected) {
  switch (selected) {
    case 'verify':
      return verifySetupPayload(interaction.guild, getVerifyPanelConfig(interaction.guild.id));
    case 'logs':
      return logsPayload(interaction.guild);
    case 'tickets':
      return ticketHomeFor(interaction.guild);
    case 'automod':
      return automodHomeFor(interaction, getAutomodConfig(interaction.guild.id));
    case 'welcome':
      return welcomePanelPayload(getWelcomeConfig(interaction.guild.id), interaction.member);
    case 'levels':
      return levelsPanelPayload(getLevelsConfig(interaction.guild.id), interaction.guild);
    case 'emojis':
      return buildEmojiPanel(interaction.guild);
    case 'autorole':
      return autorolePayload(interaction.guild);
    case 'permissions':
      return permissionsHomePayload(interaction.guild);
    case 'reactionrole':
      return reactionRolePayload(interaction.guild);
    default:
      return { embeds: [errorEmbed('Configuração desconhecida.', undefined, interaction.guild)], components: [] };
  }
}

function saveAutorole(interaction, role) {
  const problem = role ? validateAssignableRole(interaction, role) : null;
  if (problem) return { embeds: [errorEmbed(problem, undefined, interaction.guild)], components: [] };

  setGuildConfig(interaction.guild.id, 'autorole_id', role?.id ?? null);
  return {
    embeds: [successEmbed(role ? `Novos membros receberão automaticamente o cargo ${role}.` : 'Autorole desativado.', undefined, interaction.guild)],
    components: [],
  };
}

async function publishReactionRole(interaction, role, channel) {
  const problem = validateAssignableRole(interaction, role);
  if (problem) return { embeds: [errorEmbed(problem, undefined, interaction.guild)], components: [] };

  const buttonEmoji = emoji(interaction.guild, 'reaction_role');
  const result = insertReactionRole.run(interaction.guild.id, 'pending', buttonEmoji, role.id);
  const entryId = result.lastInsertRowid;
  const message = await channel.send({
    embeds: [
      baseEmbed({
        title: `${buttonEmoji} Escolha seu cargo`,
        description: `Clique no botão para receber/remover o cargo ${role.name}.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rr_${entryId}`).setLabel(role.name).setEmoji(buttonEmoji).setStyle(ButtonStyle.Secondary)
      ),
    ],
  });
  setReactionRoleMessageId.run(message.id, entryId);

  return { embeds: [successEmbed(`Self-role de ${role} publicado em ${channel}.`, undefined, interaction.guild)], components: [] };
}

async function routeConfigCenter(interaction) {
  if (!canUseCommand(interaction, 'config')) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed(PERMISSION_DENIED_MESSAGE, undefined, interaction.guild)],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const action = interaction.customId.slice(PREFIX.length);

  if (action === 'open') {
    return safeAck(interaction, () => interaction.update(selectedPanel(interaction, interaction.values[0])));
  }

  if (action === 'logs-channel') {
    const channel = interaction.channels.first();
    if (!channel) return undefined;
    setGuildConfig(interaction.guild.id, 'log_channel_id', channel.id);
    return safeAck(interaction, () =>
      interaction.update({
        embeds: [
          successEmbed(
            `Canal de logs definido: ${channel}.\nEventos registrados: mensagens editadas/deletadas, entradas/saídas, bans, warns, tickets e sorteios.`,
            undefined,
            interaction.guild
          ),
        ],
        components: [],
      })
    );
  }

  if (action === 'autorole-role') {
    return safeAck(interaction, () => interaction.update(saveAutorole(interaction, interaction.roles.first())));
  }

  if (action === 'autorole-clear') {
    return safeAck(interaction, () => interaction.update(saveAutorole(interaction, null)));
  }

  if (action === 'rr-role') {
    const role = interaction.roles.first();
    const problem = validateAssignableRole(interaction, role);
    return safeAck(interaction, () =>
      interaction.update(problem ? { embeds: [errorEmbed(problem, undefined, interaction.guild)], components: [] } : reactionRoleChannelPayload(interaction.guild, role))
    );
  }

  if (action.startsWith('rr-channel:')) {
    const role = interaction.guild.roles.cache.get(action.slice('rr-channel:'.length));
    const channel = interaction.channels.first();
    if (!channel) return undefined;
    if (!(await safeAck(interaction, () => interaction.deferUpdate()))) return undefined;
    return interaction.editReply(await publishReactionRole(interaction, role, channel));
  }

  return undefined;
}

module.exports = { PREFIX, centerPayload, routeConfigCenter };
