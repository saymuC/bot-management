// @ts-check
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { baseEmbed, errorEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { getEconomyConfig, saveEconomyConfig } = require('../config/economy');
const { canUseCommand, PERMISSION_DENIED_MESSAGE } = require('../utils/commandPermissions');

const PREFIX = 'eco_cfg_';

/** @param {import('discord.js').Guild} guild */
function buildEconomyPanel(guild) {
  const config = getEconomyConfig(guild.id);
  return {
    embeds: [baseEmbed({
      title: `${emoji(guild, 'eco_coin')} Configuração da economia`,
      description: `Status: **${config.enabled ? 'Ativada' : 'Desativada'}**\nMoeda: ${config.currencyEmoji ?? emoji(guild, 'eco_coin')} ${config.currencyName}\nDaily: ${config.dailyMin}–${config.dailyMax} (24h)\nTrabalho: ${config.workMin}–${config.workMax} (${config.workCooldownMinutes}min)\n\nAs alterações são salvas automaticamente.`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}toggle`).setLabel(config.enabled ? 'Desativar' : 'Ativar')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}rewards`).setLabel('Recompensas').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}currency`).setLabel('Moeda').setStyle(ButtonStyle.Secondary)
    ).toJSON()],
  };
}

/** @param {import('discord.js').ButtonInteraction | import('discord.js').ModalSubmitInteraction} interaction */
async function routeEconomyConfig(interaction) {
  if (!interaction.guild || !canUseCommand(interaction, 'economy-config')) {
    return interaction.reply({ embeds: [errorEmbed(PERMISSION_DENIED_MESSAGE, undefined, interaction.guild)], flags: MessageFlags.Ephemeral });
  }
  const action = interaction.customId.slice(PREFIX.length);
  if (interaction.isButton() && action === 'toggle') {
    saveEconomyConfig(interaction.guild.id, { enabled: !getEconomyConfig(interaction.guild.id).enabled });
    return interaction.update(buildEconomyPanel(interaction.guild));
  }
  if (interaction.isButton() && ['rewards', 'currency'].includes(action)) {
    const config = getEconomyConfig(interaction.guild.id);
    const modal = new ModalBuilder().setCustomId(`${PREFIX}submit_${action}`).setTitle(action === 'rewards' ? 'Recompensas da economia' : 'Moeda do servidor');
    const inputs = action === 'rewards'
      ? [
        ['dailyMin', 'Daily mínimo', config.dailyMin], ['dailyMax', 'Daily máximo', config.dailyMax],
        ['workMin', 'Trabalho mínimo', config.workMin], ['workMax', 'Trabalho máximo', config.workMax],
        ['workCooldownMinutes', 'Cooldown do trabalho (minutos)', config.workCooldownMinutes],
      ]
      : [['currencyName', 'Nome da moeda', config.currencyName], ['currencyEmoji', 'Emoji (vazio: global)', config.currencyEmoji ?? '']];
    for (const [id, label, value] of inputs) {
      modal.addComponents(new TextInputBuilder().setCustomId(String(id)).setLabel(String(label)).setStyle(TextInputStyle.Short)
        .setValue(String(value)).setRequired(id !== 'currencyEmoji'));
    }
    return interaction.showModal(modal);
  }
  if (!interaction.isModalSubmit() || !['submit_rewards', 'submit_currency'].includes(action)) return;
  const fields = interaction.fields;
  const changes = action === 'submit_rewards'
    ? Object.fromEntries(['dailyMin', 'dailyMax', 'workMin', 'workMax', 'workCooldownMinutes']
      .map((key) => [key, Number(fields.getTextInputValue(key))]))
    : { currencyName: fields.getTextInputValue('currencyName').trim(),
      currencyEmoji: fields.getTextInputValue('currencyEmoji').trim() || null };
  try {
    saveEconomyConfig(interaction.guild.id, changes);
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    return interaction.reply({ embeds: [errorEmbed(err.message, undefined, interaction.guild)], flags: MessageFlags.Ephemeral });
  }
  if (interaction.isFromMessage()) return interaction.update(buildEconomyPanel(interaction.guild));
  return interaction.reply({ ...buildEconomyPanel(interaction.guild), flags: MessageFlags.Ephemeral });
}

module.exports = { PREFIX, buildEconomyPanel, routeEconomyConfig };
