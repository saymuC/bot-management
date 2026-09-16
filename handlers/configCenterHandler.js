const {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require('discord.js');

const { setGuildConfig } = require('../database/db');
const { homeFor: ticketHomeFor } = require('./ticketSetupHandler');
const { getAutomodConfig } = require('../utils/automod/config');
const { homeFor: automodHomeFor } = require('./automodSetupHandler');
const { getVerifyPanelConfig } = require('../utils/verifyPanelConfig');
const { buildSetupPayload: verifySetupPayload } = require('./verifySetupHandler');
const { getWelcomeConfig } = require('../utils/welcomeConfig');
const { buildPanelPayload: welcomePanelPayload } = require('./welcomeSetupHandler');
const { getLevelsConfig } = require('../utils/levels/config');
const { buildPanelPayload: levelsPanelPayload } = require('./levelsSetupHandler');
const { baseEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { makeSafeAck } = require('../utils/interactionAck');

const PREFIX = 'config_';
const safeAck = makeSafeAck('config-center');

function centerPayload(guild) {
  return {
    embeds: [
      baseEmbed({
        title: '⚙️ Central de Configuração',
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
              emoji: '📜',
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
          ])
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function logsPayload() {
  return {
    embeds: [
      baseEmbed({
        title: '📜 Configuração de logs',
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
      return logsPayload();
    case 'tickets':
      return ticketHomeFor(interaction.guild);
    case 'automod':
      return automodHomeFor(interaction, getAutomodConfig(interaction.guild.id));
    case 'welcome':
      return welcomePanelPayload(getWelcomeConfig(interaction.guild.id), interaction.member);
    case 'levels':
      return levelsPanelPayload(getLevelsConfig(interaction.guild.id), interaction.guild);
    default:
      return { embeds: [errorEmbed('Configuração desconhecida.', undefined, interaction.guild)], components: [] };
  }
}

async function routeConfigCenter(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed('Você precisa ser administrador para usar este comando.', undefined, interaction.guild)],
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

  return undefined;
}

module.exports = { PREFIX, centerPayload, routeConfigCenter };
