// @ts-check
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { baseEmbed, errorEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { currency } = require('../utils/economy/currency');
const { formatMoney } = require('../utils/economy/formatter');
const { getEconomyConfig, saveEconomyConfig } = require('../config/economy');
const { canUseCommand, PERMISSION_DENIED_MESSAGE } = require('../utils/commandPermissions');
const mines = require('../utils/economy/mines/service');
const { multiplier, payout, safePickCount, BOARD_SIZE } = require('../utils/economy/mines/engine');

const PREFIX = 'mines_';
const CONFIG_PREFIX = 'eco_cfg_mines_';

function settingsPanel(guild, userId) {
  const config = getEconomyConfig(guild.id);
  const prefs = mines.getPreferences(guild.id, userId);
  const balance = mines.getBalance(guild.id, userId);
  const coin = currency(guild).icon;
  return {
    embeds: [baseEmbed({
      title: `${emoji(guild, 'eco_mines')} Mines`,
      description: `Saldo disponível: ${coin} **${formatMoney(balance)} ${currency(guild).name}**\nConfigure e inicie uma partida com moedas da economia do servidor.`,
      fields: [
        { name: 'Aposta', value: `${formatMoney(prefs.bet)} ${currency(guild).name}`, inline: true },
        { name: 'Minas', value: String(prefs.mine_count), inline: true },
        { name: 'Tabuleiro', value: `${BOARD_SIZE} casas · ${getEconomyConfig(guild.id).mines.timeoutSeconds}s por inatividade`, inline: true },
      ],
      footer: 'O tabuleiro e o estado da partida ficam salvos; uma partida ativa pode ser retomada com /mines.',
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}settings`).setLabel('Aposta e minas').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}start`).setLabel('Iniciar').setEmoji(emoji(guild, 'eco_mines')).setStyle(ButtonStyle.Success),
    ).toJSON()],
  };
}

function renderGame(guild, game) {
  const revealed = new Set(game.revealed);
  const finished = game.status !== 'active';
  const won = game.status === 'won';
  const lost = game.status === 'lost';
  const safePicks = finished && game.board ? safePickCount(game.board, game.revealed) : revealed.size;
  const activeMultiplier = multiplier(game.mine_count, safePicks, game.house_edge_bps);
  const potential = safePicks ? payout(game.bet, game.mine_count, safePicks, game.house_edge_bps) : game.bet;
  let description = 'Selecione casas seguras; cada acerto aumenta o pagamento disponível.';
  if (won) description += `\n\n${emoji(guild, 'eco_mines_cashout')} Retirada concluída: **${formatMoney(game.payout)} ${currency(guild).name}**.`;
  else if (lost) description += `\n\n${emoji(guild, 'eco_mines')} Mina encontrada. A aposta foi perdida.`;
  else if (game.status === 'expired' || game.status === 'refunded') description += '\n\nPartida encerrada; a aposta foi devolvida.';
  const fields = [
    { name: 'Aposta', value: `${formatMoney(game.bet)} ${currency(guild).name}`, inline: true },
    { name: 'Minas', value: String(game.mine_count), inline: true },
    { name: 'Multiplicador', value: `${activeMultiplier.toFixed(2)}x`, inline: true },
    { name: 'Ganho potencial', value: `${formatMoney(potential)} ${currency(guild).name}`, inline: true },
  ];
  if (won) fields.push({ name: 'Lucro líquido', value: `${formatMoney(game.payout - game.bet)} ${currency(guild).name}`, inline: true });

  const rows = [];
  for (let row = 0; row < 4; row += 1) {
    const buttons = [];
    for (let col = 0; col < 5; col += 1) {
      const position = row * 5 + col;
      const isRevealed = revealed.has(position);
      const isMine = finished && game.board.includes(position);
      const style = isMine ? ButtonStyle.Danger : isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary;
      const button = new ButtonBuilder().setCustomId(`${PREFIX}reveal_${game.id}_${position}_${game.revision ?? 0}`).setLabel(String(position + 1))
        .setStyle(style).setDisabled(finished || isRevealed);
      if (isMine) button.setEmoji(emoji(guild, 'eco_mines'));
      else if (isRevealed) button.setEmoji(emoji(guild, 'eco_mines_safe'));
      buttons.push(button);
    }
    rows.push(new ActionRowBuilder().addComponents(buttons).toJSON());
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}cashout_${game.id}_${game.revision ?? 0}`).setLabel(finished ? 'Partida encerrada' : `Retirar ${formatMoney(potential)}`)
      .setEmoji(emoji(guild, 'eco_mines_cashout')).setStyle(ButtonStyle.Success).setDisabled(finished || revealed.size === 0),
  ).toJSON());
  return { embeds: [baseEmbed({ title: `${emoji(guild, 'eco_mines')} Mines · partida #${game.id}`, description, fields })], components: rows };
}

async function showInteractionError(interaction, message) {
  const payload = { embeds: [errorEmbed(message, undefined, interaction.guild)] };
  if (interaction.deferred || interaction.replied) return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function settingsModal(guild, userId) {
  const current = mines.getPreferences(guild.id, userId);
  const modal = new ModalBuilder().setCustomId(`${PREFIX}submit_settings`).setTitle('Configurar Mines');
  modal.addComponents(new TextInputBuilder().setCustomId('bet').setLabel('Aposta em moedas')
    .setStyle(TextInputStyle.Short).setValue(String(current.bet)).setRequired(true));
  modal.addComponents(new TextInputBuilder().setCustomId('mines').setLabel('Quantidade de minas')
    .setStyle(TextInputStyle.Short).setValue(String(current.mine_count)).setRequired(true));
  return modal;
}

async function routeMinesInteraction(interaction) {
  const customId = interaction.customId;
  if (customId.startsWith(CONFIG_PREFIX)) return routeMinesConfig(interaction);
  if (!interaction.guild) return showInteractionError(interaction, 'Mines só está disponível em servidores.');
  const action = customId.slice(PREFIX.length);
  if (action === 'settings' && interaction.isButton()) return interaction.showModal(settingsModal(interaction.guild, interaction.user.id));
  if (action === 'submit_settings' && interaction.isModalSubmit()) {
    try {
      const bet = Number(interaction.fields.getTextInputValue('bet'));
      const mineCount = Number(interaction.fields.getTextInputValue('mines'));
      mines.setPreferences(interaction.guild.id, interaction.user.id, bet, mineCount);
      return interaction.reply({ ...settingsPanel(interaction.guild, interaction.user.id), flags: MessageFlags.Ephemeral });
    } catch (error) {
      return showInteractionError(interaction, error instanceof Error ? error.message : 'Configuração inválida.');
    }
  }
  if (action === 'start' && interaction.isButton()) {
    try {
      const prefs = mines.getPreferences(interaction.guild.id, interaction.user.id);
      const game = mines.createGame({ guildId: interaction.guild.id, userId: interaction.user.id, bet: prefs.bet, mineCount: prefs.mine_count });
      await interaction.update(renderGame(interaction.guild, game));
      const message = await interaction.fetchReply();
      mines.attachMessage(game.id, interaction.channelId, message.id);
      return;
    } catch (error) {
      return interaction.reply({ embeds: [errorEmbed(error instanceof Error ? error.message : 'Não foi possível iniciar a partida.', undefined, interaction.guild)], flags: MessageFlags.Ephemeral });
    }
  }
  const reveal = /^reveal_(\d+)_(\d+)_(\d+)$/.exec(action);
  const cashout = /^cashout_(\d+)_(\d+)$/.exec(action);
  if (!reveal && !cashout) return showInteractionError(interaction, 'Ação do Mines inválida.');
  try {
    const match = reveal || cashout;
    if (!match) return;
    const params = { guildId: interaction.guild.id, userId: interaction.user.id, gameId: Number(match[1]), revision: Number(match.at(-1)) };
    const game = reveal
      ? mines.revealCell({ ...params, position: Number(reveal[2]) })
      : mines.cashOut(params);
    return interaction.update(renderGame(interaction.guild, game));
  } catch (error) {
    if (error instanceof Error && /painel ficou desatualizado/.test(error.message)) {
      const match = reveal || cashout;
      if (match) {
        const game = mines.getGame(interaction.guild.id, interaction.user.id, Number(match[1]));
        if (game) return interaction.update(renderGame(interaction.guild, game));
      }
    }
    return interaction.followUp({ embeds: [errorEmbed(error instanceof Error ? error.message : 'Não foi possível processar a jogada.', undefined, interaction.guild)], flags: MessageFlags.Ephemeral });
  }
}

function minesConfigPanel(guild) {
  const config = getEconomyConfig(guild.id).mines;
  return {
    embeds: [baseEmbed({ title: `${emoji(guild, 'eco_mines')} Configuração de Mines`, description: `Disponibilidade: **${config.enabled ? 'Ativada' : 'Desativada'}**`, fields: [
      { name: 'Apostas', value: `${config.minBet}–${config.maxBet}`, inline: true },
      { name: 'Máximo de minas', value: String(config.maxMines), inline: true },
      { name: 'Vantagem da casa', value: `${(config.houseEdgeBps / 100).toFixed(2)}%`, inline: true },
      { name: 'Tempo', value: `${config.timeoutSeconds}s`, inline: true },
    ] })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}toggle`).setLabel(config.enabled ? 'Desativar Mines' : 'Ativar Mines').setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}rules`).setLabel('Limites e regras').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${CONFIG_PREFIX}back`).setLabel('Voltar').setStyle(ButtonStyle.Secondary),
    ).toJSON()],
  };
}

async function sweepMines(client, now = Date.now()) {
  const expiredGames = mines.expireDueGames(now);
  if (!client) return expiredGames.length;
  await Promise.all(expiredGames.map(async (game) => {
    if (!game.channel_id || !game.message_id) return;
    const channel = await client.channels.fetch(game.channel_id).catch(() => null);
    if (!channel?.isTextBased() || !channel.messages) return;
    const message = await channel.messages.fetch(game.message_id).catch(() => null);
    if (message) await message.edit(renderGame(message.guild, game)).catch(() => null);
  }));
  return expiredGames.length;
}

function startMinesSweeper(client) {
  const sweep = () => {
    sweepMines(client).catch((error) => console.error('[mines] Erro ao reembolsar partidas expiradas:', error));
  };
  sweep();
  setInterval(sweep, 30_000).unref();
}

async function routeMinesConfig(interaction) {
  if (!interaction.guild || !canUseCommand(interaction, 'economy-config')) {
    const payload = { embeds: [errorEmbed(PERMISSION_DENIED_MESSAGE, undefined, interaction.guild)], flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
    return interaction.reply(payload);
  }
  const action = interaction.customId.slice(CONFIG_PREFIX.length);
  if (action === 'back') return interaction.update(require('./economyHandler').buildEconomyPanel(interaction.guild));
  if (action === 'toggle' && interaction.isButton()) {
    const config = getEconomyConfig(interaction.guild.id);
    saveEconomyConfig(interaction.guild.id, { mines: { enabled: !config.mines.enabled } });
    return interaction.update(minesConfigPanel(interaction.guild));
  }
  if (action === 'rules' && interaction.isButton()) {
    const config = getEconomyConfig(interaction.guild.id).mines;
    const modal = new ModalBuilder().setCustomId(`${CONFIG_PREFIX}submit_rules`).setTitle('Regras de Mines');
    for (const [id, label, value] of [
      ['minBet', 'Aposta mínima', config.minBet], ['maxBet', 'Aposta máxima', config.maxBet],
      ['maxMines', 'Máximo de minas (1–8)', config.maxMines], ['houseEdgeBps', 'Vantagem em pontos-base', config.houseEdgeBps],
      ['timeoutSeconds', 'Expiração em segundos (60–3600)', config.timeoutSeconds],
    ]) modal.addComponents(new TextInputBuilder().setCustomId(String(id)).setLabel(String(label))
      .setStyle(TextInputStyle.Short).setValue(String(value)).setRequired(true));
    return interaction.showModal(modal);
  }
  if (action === 'submit_rules' && interaction.isModalSubmit()) {
    try {
      const minesConfig = Object.fromEntries(['minBet', 'maxBet', 'maxMines', 'houseEdgeBps', 'timeoutSeconds']
        .map((key) => [key, Number(interaction.fields.getTextInputValue(key))]));
      saveEconomyConfig(interaction.guild.id, { mines: minesConfig });
      return interaction.reply({ ...minesConfigPanel(interaction.guild), flags: MessageFlags.Ephemeral });
    } catch (error) {
      return showInteractionError(interaction, error instanceof Error ? error.message : 'Configuração inválida.');
    }
  }
}

module.exports = { PREFIX, settingsPanel, renderGame, minesConfigPanel, routeMinesInteraction, routeMinesConfig, startMinesSweeper, sweepMines };
