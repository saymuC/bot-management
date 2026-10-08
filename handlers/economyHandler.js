// @ts-check
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { baseEmbed, errorEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { getEconomyConfig, saveEconomyConfig } = require('../config/economy');
const { currency } = require('../utils/economy/currency');
const { canUseCommand, PERMISSION_DENIED_MESSAGE } = require('../utils/commandPermissions');

const PREFIX = 'eco_cfg_';

/** @param {import('discord.js').Guild} guild */
function buildEconomyPanel(guild) {
  const config = getEconomyConfig(guild.id);
  const coin = currency(guild).icon;
  return {
    embeds: [baseEmbed({
      title: `${emoji(guild, 'eco_shop')} Economia do servidor`,
      description: `Tudo abaixo é salvo automaticamente. ${config.enabled ? 'As recompensas e compras estão disponíveis.' : `${emoji(guild, 'warning')} Economia desligada: ganhos e compras ficam pausados; saldos e itens são preservados.`}`,
      color: config.enabled ? undefined : 0x95a5a6,
      fields: [
        { name: 'Status', value: config.enabled ? `${emoji(guild, 'success')} Ativada` : `${emoji(guild, 'warning')} Desativada`, inline: true },
        { name: 'Moeda', value: `${coin} ${config.currencyName}`, inline: true },
        { name: `${emoji(guild, 'eco_daily')} Recompensa diária`, value: `${config.dailyMin.toLocaleString('pt-BR')} a ${config.dailyMax.toLocaleString('pt-BR')} · 24h`, inline: false },
        { name: `${emoji(guild, 'eco_work')} Trabalho`, value: `${config.workMin.toLocaleString('pt-BR')} a ${config.workMax.toLocaleString('pt-BR')} · a cada ${config.workCooldownMinutes} min`, inline: false },
      ],
      footer: `Servidor: ${guild.name}`,
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}toggle`).setLabel(config.enabled ? 'Desativar' : 'Ativar')
        .setEmoji(emoji(guild, config.enabled ? 'warning' : 'success'))
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}rewards`).setLabel('Recompensas').setEmoji(emoji(guild, 'eco_daily')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}currency`).setLabel('Moeda').setEmoji(coin).setStyle(ButtonStyle.Secondary)
    ).toJSON(), new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}close`).setLabel('Fechar').setEmoji(emoji(guild, 'error')).setStyle(ButtonStyle.Secondary)
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
  if (interaction.isButton() && action === 'close') {
    return interaction.update({ embeds: [baseEmbed({ title: `${emoji(interaction.guild, 'eco_coin')} Economia`, description: 'Painel fechado. Todas as alterações já estão salvas.' })], components: [] });
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
