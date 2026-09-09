/**
 * Proteção contra raid: avaliada na entrada do membro, não em mensagens.
 *
 * Duas regras independentes:
 *   joinRate          — N entradas em T segundos ligam um alerta temporário.
 *                       Enquanto ele durar, quem entra recebe a ação configurada.
 *   suspiciousAccount — avalia a conta em si (idade, avatar, nome padrão).
 *
 * O "lockdown" aqui **não altera permissão de canal** de propósito. Trancar o
 * servidor inteiro é destrutivo e difícil de desfazer direito — se o bot cair no
 * meio, o servidor fica trancado sem ninguém saber por quê. O alerta age sobre
 * quem entra, que é a origem do problema, e expira sozinho.
 */

const { emoji } = require('../emojis');
const { colors } = require('../../config/settings');
const { formatDuration } = require('../time');
const { ACTIONS } = require('../../config/automodRules');
const { trackJoin, joinCount } = require('./tracker');
const { applyAction, automodLog } = require('./enforce');
const { recordInfraction } = require('./infractions');

/** `guildId` -> { until: number, joins: number } enquanto o alerta está ligado. */
const raidAlerts = new Map();

/** Idade da conta em dias. */
const accountAgeDays = (user) => (Date.now() - user.createdTimestamp) / 86_400_000;

/**
 * Nome no formato que o Discord gera para contas novas sem nome escolhido:
 * `usuario_12345`, `user_0a1b2c`. Sozinho é sinal fraco, por isso vem desligado.
 */
const hasDefaultName = (user) => /^[a-z]+_[a-z0-9]{4,}$/i.test(user.username);

/** O servidor está sob alerta de raid neste instante? */
function raidAlert(guildId, now = Date.now()) {
  const alert = raidAlerts.get(guildId);
  if (!alert) return null;
  if (alert.until <= now) {
    raidAlerts.delete(guildId);
    return null;
  }
  return alert;
}

/** Motivos pelos quais a conta parece suspeita. */
function suspicionReasons(user, limits) {
  const reasons = [];

  const age = accountAgeDays(user);
  if (limits.minAccountAgeDays > 0 && age < limits.minAccountAgeDays) {
    reasons.push(`conta com ${Math.floor(age)}d (mínimo: ${limits.minAccountAgeDays}d)`);
  }
  if (limits.requireAvatar && !user.avatar) reasons.push('sem avatar');
  if (limits.blockDefaultName && hasDefaultName(user)) reasons.push('nome padrão do Discord');

  return reasons;
}

/**
 * Avalia um membro que acabou de entrar.
 *
 * @returns {Promise<{ suppressAutorole: boolean, suppressWelcome: boolean, hits: Array<{ key: string, detail: string }> }>}
 *   `suppress*` dizem ao `guildMemberAdd` o que não fazer. Quem foi expulso ou
 *   banido não deve receber cargo nem boas-vindas.
 */
async function inspectJoin(member, config) {
  const result = { suppressAutorole: false, suppressWelcome: false, hits: [] };
  const now = Date.now();

  const rate = config.rules.joinRate;
  const suspicious = config.rules.suspiciousAccount;

  // A entrada é contada mesmo com a regra desligada? Não: sem a regra ligada o
  // dado não serve a nada, e contar de graça só gastaria memória.
  if (rate?.enabled) {
    trackJoin(member.guild.id, now);

    const joins = joinCount(member.guild.id, rate.limits.windowSeconds * 1000, now);
    const already = raidAlert(member.guild.id, now);

    if (!already && joins >= rate.limits.joins) {
      const durationMs = rate.limits.alertMinutes * 60_000;
      raidAlerts.set(member.guild.id, { until: now + durationMs, joins });

      await automodLog(
        member.guild,
        config,
        `${emoji(member.guild, 'raid')} Alerta de raid ligado`,
        `**${joins}** entradas em ${rate.limits.windowSeconds}s. O alerta vale por ${formatDuration(durationMs)}.`,
        colors.error,
        [
          {
            name: 'Enquanto durar',
            value: `quem entrar recebe: **${ACTIONS[rate.action]?.label ?? rate.action}**`,
            inline: false,
          },
        ]
      );
    }

    if (raidAlert(member.guild.id, now)) {
      result.hits.push({ key: 'joinRate', detail: `entrou durante alerta de raid (${joins} entradas na janela)` });
      if (rate.limits.suppressAutorole) result.suppressAutorole = true;
    }
  }

  if (suspicious?.enabled) {
    const reasons = suspicionReasons(member.user, suspicious.limits);
    if (reasons.length) {
      result.hits.push({ key: 'suspiciousAccount', detail: reasons.join(', ') });
      if (suspicious.limits.suppressAutorole) result.suppressAutorole = true;
    }
  }

  for (const hit of result.hits) {
    const rule = config.rules[hit.key];
    const reason = `AutoMod: ${hit.detail}`;

    // eslint-disable-next-line no-await-in-loop -- no máximo duas regras aqui
    const applied = await applyAction(member, rule.action, rule.muteMs, reason);

    recordInfraction({
      guildId: member.guild.id,
      userId: member.id,
      ruleKey: hit.key,
      points: rule.points,
      reason: hit.detail,
      channelId: null,
      action: rule.action,
    });

    if (['kick', 'ban'].includes(rule.action) && applied.ok) {
      result.suppressWelcome = true;
      result.suppressAutorole = true;
    }

    if (rule.notify === 'dm' && rule.action !== 'none') {
      // eslint-disable-next-line no-await-in-loop
      await member.send({ content: `**${member.guild.name}**: ${hit.detail}.` }).catch(() => {});
    }

    // eslint-disable-next-line no-await-in-loop
    await automodLog(
      member.guild,
      config,
      `${emoji(member.guild, 'raid')} Entrada sinalizada`,
      `${member} foi sinalizado na entrada.`,
      applied.ok ? colors.warning : colors.error,
      [
        { name: 'Membro', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
        { name: 'Conta criada', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Motivo', value: hit.detail, inline: false },
        {
          name: 'Ação',
          value: applied.ok ? applied.detail || 'nenhuma' : `⚠️ ${applied.detail}`,
          inline: false,
        },
      ]
    );
  }

  return result;
}

/** Só para os testes: limpa os alertas em memória. */
const resetRaidAlerts = () => raidAlerts.clear();

module.exports = {
  accountAgeDays,
  hasDefaultName,
  raidAlert,
  suspicionReasons,
  inspectJoin,
  resetRaidAlerts,
};
