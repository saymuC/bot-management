/**
 * Corpo compartilhado de `/add-xp`, `/remove-xp` e `/set-level`.
 *
 * Os três fazem exatamente a mesma coisa em ordens diferentes de um único
 * parâmetro: alteram o XP, reconciliam os cargos com o novo nível e registram no
 * log quem mexeu, em quem e de quanto para quanto. Deixar isso em cada comando
 * seria três cópias de uma sequência em que esquecer a reconciliação passa
 * despercebido — um membro rebaixado ficaria com cargos que já não valem.
 */

const { successEmbed, errorEmbed } = require('../embeds');
const { colors } = require('../../config/settings');
const { logEvent } = require('../logger');
const { changeXp, setUserLevel } = require('./service');
const { getLevelsConfig } = require('./config');
const { syncMemberRewards } = require('./rewards');
const { formatXp } = require('./leaderboard');

/** Rótulos de log por operação. */
const LABELS = Object.freeze({
  add: { title: '📈 XP adicionado', color: colors.success },
  remove: { title: '📉 XP removido', color: colors.warning },
  set: { title: '📊 Nível definido', color: colors.info },
});

/**
 * Aplica uma alteração administrativa de XP e devolve o payload da resposta.
 *
 * @param {object} params
 * @param {import('discord.js').ChatInputCommandInteraction} params.interaction
 * @param {import('discord.js').User} params.user alvo
 * @param {'add'|'remove'|'set'} params.operation
 * @param {number} params.amount XP (add/remove) ou nível (set)
 * @returns {Promise<{ embeds: object[] }>}
 */
async function applyAdminXp({ interaction, user, operation, amount }) {
  if (user.bot) {
    return { embeds: [errorEmbed('Bots não participam do sistema de níveis.')] };
  }

  const guildId = interaction.guild.id;
  const source = `${operation} por ${interaction.user.id}`;

  const change =
    operation === 'set'
      ? setUserLevel({ guildId, userId: user.id, level: amount, source })
      : changeXp({ guildId, userId: user.id, operation, amount, source });

  const config = getLevelsConfig(guildId);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const problems = [];

  // Reconcilia nos dois sentidos: subir concede o que falta, descer retira o que
  // deixou de valer. Uma falha aqui não desfaz o XP já gravado, só é relatada.
  if (member) {
    const sync = await syncMemberRewards(member, config, change.newLevel, `Ajuste de XP por ${interaction.user.tag}`);
    problems.push(...sync.problems);
  }

  const label = LABELS[operation] ?? LABELS.set;
  const detail =
    `**Usuário:** ${user.tag} (${user.id})\n` +
    `**Administrador:** ${interaction.user.tag}\n` +
    `**Operação:** ${operation}${operation === 'set' ? ` nível ${amount}` : ` ${amount} XP`}\n` +
    `**XP:** ${change.previousXp} → ${change.totalXp}\n` +
    `**Nível:** ${change.previousLevel} → ${change.newLevel}`;

  await logEvent(interaction.guild, label.title, detail, label.color);

  const moved = change.previousLevel !== change.newLevel;
  const lines = [
    `**${user.tag}**: ${formatXp(change.previousXp)} → **${formatXp(change.totalXp)} XP**.`,
    moved
      ? `Nível **${change.previousLevel}** → **${change.newLevel}**.`
      : `Continua no nível **${change.newLevel}**.`,
  ];
  if (problems.length) lines.push(`\n⚠️ Cargos: ${problems.join(' · ')}`);

  return { embeds: [successEmbed(lines.join('\n'), label.title)] };
}

module.exports = { LABELS, applyAdminXp };
