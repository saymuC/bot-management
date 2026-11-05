// @ts-check
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const { baseEmbed, errorEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { currency } = require('../utils/economy/currency');
const { formatMoney } = require('../utils/economy/formatter');
const { getEconomyConfig, saveEconomyConfig } = require('../config/economy');
const { canUseCommand, PERMISSION_DENIED_MESSAGE } = require('../utils/commandPermissions');
const { logError } = require('../utils/observability');
const mines = require('../utils/economy/mines/service');
const { multiplier, payout, safeTileIncrement, safePickCount, BOARD_SIZE, MIN_BOARD_SIZE } = require('../utils/economy/mines/engine');

const PREFIX = 'mines_';
const CONFIG_PREFIX = 'eco_cfg_mines_';
const panelEditors = new Map();
const isExpectedMessageAbsence = (error) => [10003, 10008, 10015].includes(Number(error?.code));

function rememberPanelEditor(gameId, webhook, messageId, guild, userId) {
  if (!webhook?.editMessage || !messageId) return;
  const userKey = `${guild.id}:${userId}`;
  const previous = panelEditors.get(gameId);
  if (previous && previous.messageId !== messageId) previous.webhook.deleteMessage?.(previous.messageId).catch(() => null);
  panelEditors.set(gameId, { webhook, messageId, guild, userKey });
  for (const [id, editor] of panelEditors) {
    if (id !== gameId && editor.userKey === userKey) {
      if (editor.messageId !== messageId) editor.webhook.deleteMessage?.(editor.messageId).catch(() => null);
      panelEditors.delete(id);
    }
  }
}

function settingsPanel(guild, userId) {
  const prefs = mines.getPreferences(guild.id, userId);
  const balance = mines.getBalance(guild.id, userId);
  const coin = currency(guild).icon;
  return {
    embeds: [baseEmbed({
      title: `${emoji(guild, 'eco_mines')} Mines`,
      description: `Saldo disponível: ${coin} **${formatMoney(balance)} ${currency(guild).name}**\nEscolha a aposta e as minas para iniciar.`,
      fields: [
        { name: 'Aposta', value: `${formatMoney(prefs.bet)} ${currency(guild).name}`, inline: true },
      { name: 'Casas', value: String(prefs.board_size), inline: true },
      { name: 'Minas', value: String(prefs.mine_count), inline: true },
      ],
      footer: `${getEconomyConfig(guild.id).mines.timeoutSeconds}s de inatividade · retome uma partida ativa com /mines`,
    })],
    components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}settings`).setLabel('Casas, minas e aposta').setStyle(ButtonStyle.Secondary),
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
  const board = game.board ?? [];
  const activeMultiplier = multiplier(game.mine_count, safePicks, game.house_edge_bps, game.board_size);
  const potential = safePicks ? payout(game.bet, game.mine_count, safePicks, game.house_edge_bps, game.board_size) : game.bet;
  const nextIncrement = safePicks < game.board_size - game.mine_count
    ? safeTileIncrement(game.bet, game.mine_count, safePicks + 1, game.house_edge_bps, game.board_size) : 0;
  let description = 'Selecione casas seguras; cada acerto aumenta o pagamento disponível.';
  if (won) description += `\n\n${emoji(guild, 'eco_mines_cashout')} Retirada concluída: **${formatMoney(game.payout)} ${currency(guild).name}**.`;
  else if (lost) description += `\n\n${emoji(guild, 'eco_mines')} Mina encontrada. A aposta foi perdida.`;
  else if (game.status === 'expired' || game.status === 'refunded') description += '\n\nPartida encerrada; a aposta foi devolvida.';
  const fields = game.status === 'active' ? [
    { name: 'Aposta', value: `${formatMoney(game.bet)} ${currency(guild).name}`, inline: true },
    { name: 'Casas', value: String(game.board_size), inline: true },
    { name: 'Minas', value: String(game.mine_count), inline: true },
    { name: 'Multiplicador', value: `${activeMultiplier.toFixed(2)}x`, inline: true },
    { name: 'Próxima casa segura', value: `${formatMoney(nextIncrement)} ${currency(guild).name}`, inline: true },
    { name: 'Ganho disponível', value: `${formatMoney(potential)} ${currency(guild).name}`, inline: true },
  ] : won ? [
    { name: 'Pagamento recebido', value: `${formatMoney(game.payout)} ${currency(guild).name}`, inline: true },
    { name: 'Lucro líquido', value: `${formatMoney(game.payout - game.bet)} ${currency(guild).name}`, inline: true },
  ] : game.status === 'lost' ? [
    { name: 'Aposta perdida', value: `-${formatMoney(game.bet)} ${currency(guild).name}`, inline: true },
  ] : [
    { name: 'Valor reembolsado', value: `+${formatMoney(game.bet)} ${currency(guild).name}`, inline: true },
  ];

  const rows = [];
  const rowCount = Math.ceil(game.board_size / 5);
  for (let row = 0; row < rowCount; row += 1) {
    const buttons = [];
    for (let col = 0; col < 5; col += 1) {
      const position = row * 5 + col;
      if (position >= game.board_size) break;
      const isRevealed = revealed.has(position);
      const isMine = finished && board.includes(position);
      const style = isMine ? ButtonStyle.Danger : isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary;
      const revealedIndex = game.revealed.indexOf(position);
      const safeOrdinal = revealedIndex < 0 ? 0 : game.revealed.slice(0, revealedIndex + 1)
        .reduce((count, cell) => count + (!board.includes(cell) ? 1 : 0), 0);
      const safeValue = isRevealed && !isMine ? safeTileIncrement(game.bet, game.mine_count, safeOrdinal, game.house_edge_bps, game.board_size) : 0;
      const button = new ButtonBuilder().setCustomId(`${PREFIX}reveal_${game.id}_${position}_${game.revision ?? 0}`)
        .setStyle(style).setDisabled(finished || isRevealed);
      if (isMine) button.setEmoji(emoji(guild, 'eco_mines'));
      else if (isRevealed) {
        button.setLabel(`+${formatMoney(safeValue)}`).setEmoji(emoji(guild, 'eco_mines_safe'));
      }
      else button.setEmoji(emoji(guild, 'eco_mines_hidden'));
      buttons.push(button);
    }
    rows.push(new ActionRowBuilder().addComponents(buttons).toJSON());
  }
  const controls = new ActionRowBuilder();
  if (finished) controls.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}home`).setLabel('Voltar ao início').setStyle(ButtonStyle.Primary));
  else controls.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}cashout_${game.id}_${game.revision ?? 0}`).setLabel(`Retirar ${formatMoney(potential)}`)
    .setEmoji(emoji(guild, 'eco_mines_cashout')).setStyle(ButtonStyle.Success).setDisabled(revealed.size === 0));
  rows.push(controls.toJSON());
  return { embeds: [baseEmbed({ title: `${emoji(guild, 'eco_mines')} Mines`, description, fields, footer: `Partida #${game.id}` })], components: rows };
}

async function showInteractionError(interaction, message) {
  const payload = { embeds: [errorEmbed(message, undefined, interaction.guild)] };
  if (interaction.deferred || interaction.replied) return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function reportUpdateFailure(interaction, error) {
  logError('mines.interaction_update', error, { guildId: interaction.guildId, userId: interaction.user?.id, customId: interaction.customId });
  const payload = { embeds: [errorEmbed('Não foi possível atualizar o painel. A partida foi salva; use /mines para recuperá-la.', undefined, interaction.guild)], flags: MessageFlags.Ephemeral };
  return Promise.resolve().then(() => interaction.deferred || interaction.replied
    ? interaction.followUp(payload) : interaction.reply(payload)).catch((replyError) => {
    logError('mines.interaction_recovery_reply', replyError, { guildId: interaction.guildId, userId: interaction.user?.id });
  });
}

function settingsModal(guild, userId) {
  const current = mines.getPreferences(guild.id, userId);
  const modal = new ModalBuilder().setCustomId(`${PREFIX}submit_settings`).setTitle('Configurar Mines');
  modal.addComponents(new TextInputBuilder().setCustomId('bet').setLabel('Aposta em moedas')
    .setStyle(TextInputStyle.Short).setValue(String(current.bet)).setRequired(true));
  modal.addComponents(new TextInputBuilder().setCustomId('boardSize').setLabel(`Número de casas (${MIN_BOARD_SIZE}–${BOARD_SIZE})`)
    .setStyle(TextInputStyle.Short).setValue(String(current.board_size)).setRequired(true));
  modal.addComponents(new TextInputBuilder().setCustomId('mines').setLabel(`Quantidade de minas (1–${current.board_size - 1})`)
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
      const boardSize = Number(interaction.fields.getTextInputValue('boardSize'));
      const mineCount = Number(interaction.fields.getTextInputValue('mines'));
      mines.setPreferences(interaction.guild.id, interaction.user.id, bet, boardSize, mineCount);
      return interaction.reply({ ...settingsPanel(interaction.guild, interaction.user.id), flags: MessageFlags.Ephemeral });
    } catch (error) {
      return showInteractionError(interaction, error instanceof Error ? error.message : 'Configuração inválida.');
    }
  }
  if (action === 'home' && interaction.isButton()) return interaction.update(settingsPanel(interaction.guild, interaction.user.id));
  if (action === 'start' && interaction.isButton()) {
    const alreadyAcknowledged = interaction.deferred || interaction.replied;
    let responseAttempted = false;
    try {
      const prefs = mines.getPreferences(interaction.guild.id, interaction.user.id);
      const game = mines.createGame({ guildId: interaction.guild.id, userId: interaction.user.id, bet: prefs.bet,
        boardSize: prefs.board_size, mineCount: prefs.mine_count });
      if (alreadyAcknowledged) {
        responseAttempted = true;
        const message = await interaction.followUp({ ...renderGame(interaction.guild, game), flags: MessageFlags.Ephemeral });
        mines.attachMessage(game.id, interaction.channelId, message.id);
        rememberPanelEditor(game.id, interaction.webhook, message.id, interaction.guild, interaction.user.id);
      } else {
        responseAttempted = true;
        await interaction.update(renderGame(interaction.guild, game));
        mines.attachMessage(game.id, interaction.channelId, interaction.message.id);
        rememberPanelEditor(game.id, interaction.webhook, interaction.message.id, interaction.guild, interaction.user.id);
      }
      return;
    } catch (error) {
      if (responseAttempted) return reportUpdateFailure(interaction, error);
      return showInteractionError(interaction, error instanceof Error ? error.message : 'Não foi possível iniciar a partida.');
    }
  }
  const reveal = /^reveal_(\d+)_(\d+)_(\d+)$/.exec(action);
  const cashout = /^cashout_(\d+)_(\d+)$/.exec(action);
  if (!reveal && !cashout) return showInteractionError(interaction, 'Ação do Mines inválida.');
  let responseAttempted = false;
  try {
    const match = reveal || cashout;
    if (!match) return;
    const params = { guildId: interaction.guild.id, userId: interaction.user.id, gameId: Number(match[1]), revision: Number(match.at(-1)) };
    const game = reveal
      ? mines.revealCell({ ...params, position: Number(reveal[2]) })
      : mines.cashOut(params);
    responseAttempted = true;
    const result = await interaction.update(renderGame(interaction.guild, game));
    rememberPanelEditor(game.id, interaction.webhook, interaction.message.id, interaction.guild, interaction.user.id);
    return result;
  } catch (error) {
    if (responseAttempted) return reportUpdateFailure(interaction, error);
    if (error instanceof Error && /painel ficou desatualizado/.test(error.message)) {
      const match = reveal || cashout;
      if (match) {
        const gameId = Number(match[1]);
        const currentRevision = mines.getGameRevision(interaction.guild.id, interaction.user.id, gameId);
        const messageId = interaction.message.id;
        const isRecentPanel = !panelEditors.has(gameId) || panelEditors.get(gameId).messageId === messageId;
        const game = mines.getGame(interaction.guild.id, interaction.user.id, gameId);
        if (game && currentRevision !== null && isRecentPanel) {
          rememberPanelEditor(game.id, interaction.webhook, interaction.message.id, interaction.guild, interaction.user.id);
          responseAttempted = true;
          return interaction.update(renderGame(interaction.guild, game))
            .catch((updateError) => reportUpdateFailure(interaction, updateError));
        }
      }
    }
    return showInteractionError(interaction, error instanceof Error ? error.message : 'Não foi possível processar a jogada.');
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
    const editor = panelEditors.get(game.id);
    let updated = false;
    if (game.channel_id && game.message_id) {
      const channel = await client.channels.fetch(game.channel_id).catch(() => null);
      if (channel?.isTextBased() && channel.messages) {
        const message = await channel.messages.fetch(game.message_id).catch((error) => {
          if (!isExpectedMessageAbsence(error)) logError('mines.expiration_fetch', error, { guildId: game.guild_id, gameId: game.id, channelId: game.channel_id });
          return null;
        });
        if (message) updated = Boolean(await message.edit(renderGame(message.guild, game)).then(() => true).catch((error) => {
          if (!isExpectedMessageAbsence(error)) logError('mines.expiration_edit', error, { guildId: game.guild_id, gameId: game.id, messageId: game.message_id });
          return false;
        }));
      }
    }
    if (!updated && editor) {
      await editor.webhook.editMessage(editor.messageId, renderGame(editor.guild, game)).catch((error) => {
        if (!isExpectedMessageAbsence(error)) logError('mines.expiration_webhook_edit', error, { guildId: game.guild_id, gameId: game.id, messageId: editor.messageId });
      });
    }
    panelEditors.delete(game.id);
  }));
  return expiredGames.length;
}

function startMinesSweeper(client) {
  const sweep = () => {
    sweepMines(client).catch((error) => logError('mines.expiration_sweep', error));
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
      ['maxMines', `Limite global de minas (até ${BOARD_SIZE - 1})`, config.maxMines], ['houseEdgeBps', 'Vantagem em pontos-base', config.houseEdgeBps],
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

module.exports = { PREFIX, settingsPanel, renderGame, minesConfigPanel, routeMinesInteraction, routeMinesConfig, startMinesSweeper, sweepMines, rememberPanelEditor, panelEditors };
