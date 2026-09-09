const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, successEmbed, errorEmbed } = require('../../utils/embeds');
const { logEvent } = require('../../utils/logger');
const { colors } = require('../../config/settings');
const { emoji } = require('../../utils/emojis');
const { formatDuration, parseSqlDate } = require('../../utils/time');
const { RULES, ACTIONS } = require('../../config/automodRules');
const { getAutomodConfig } = require('../../utils/automod/config');
const {
  listInfractions,
  countInfractions,
  clearInfractions,
  activePoints,
  ladderStep,
} = require('../../utils/automod/infractions');

/** Quantas linhas do histórico o embed mostra. */
const HISTORY_LIMIT = 10;

/** Teto do motivo. O audit log do Discord corta em 512; o resto é margem. */
const MAX_REASON = 400;

/**
 * Desfaz o que o AutoMod (ou um moderador) aplicou: tira o timeout e o ban.
 *
 * Kick não tem desfazer — o membro só precisa voltar. Advertências também ficam:
 * são registro, não restrição, e continuam visíveis no `/warnings`.
 *
 * Devolve uma linha por tentativa, sempre — inclusive "não havia nada", porque
 * "desfiz" sem detalhe deixa a dúvida de se o comando fez algo.
 *
 * O `why` vai para o audit log do Discord, não só para o log do bot: quem for
 * auditar pelo painel do servidor precisa achar o motivo lá também.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} user
 * @param {import('discord.js').GuildMember} moderator quem pediu
 * @param {string} reason motivo informado, obrigatório
 * @returns {Promise<{ lines: string[], changed: boolean }>}
 */
async function undoPunishments(guild, user, moderator, reason) {
  const lines = [];
  let changed = false;
  const why = `Perdão por ${moderator.user.tag}: ${reason}`.slice(0, 512);

  const member = await guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    lines.push('🔇 **Silenciamento:** o membro não está no servidor.');
  } else if (!member.isCommunicationDisabled()) {
    lines.push('🔇 **Silenciamento:** não havia nenhum ativo.');
  } else if (!member.moderatable) {
    lines.push('🔇 **Silenciamento:** ativo, mas não alcanço o membro (hierarquia de cargos).');
  } else {
    try {
      await member.timeout(null, why);
      lines.push('🔇 **Silenciamento:** removido.');
      changed = true;
    } catch (err) {
      lines.push(`🔇 **Silenciamento:** falhou — ${err.message}`);
    }
  }

  // `bans.fetch` de um id não banido devolve erro; é assim que se consulta.
  const ban = await guild.bans.fetch(user.id).catch(() => null);

  if (!ban) {
    lines.push('🔨 **Banimento:** não havia nenhum.');
  } else if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) {
    lines.push('🔨 **Banimento:** ativo, mas desbanir exige a permissão de **Banir membros**.');
  } else {
    try {
      await guild.bans.remove(user.id, why);
      lines.push('🔨 **Banimento:** removido.');
      changed = true;
    } catch (err) {
      lines.push(`🔨 **Banimento:** falhou — ${err.message}`);
    }
  }

  return { lines, changed };
}

/**
 * Avisa o membro na DM, quando o moderador pediu.
 *
 * Falha é rotina, não erro: DM fechada, ou — o caso mais comum aqui — usuário
 * recém-desbanido, com quem o bot não divide mais nenhum servidor. Por isso a
 * função nunca lança e sempre devolve uma linha para o relatório.
 *
 * @returns {Promise<string>} linha a mostrar ao moderador
 */
async function notifyPardon(guild, user, reason, done) {
  try {
    await user.send({
      embeds: [
        baseEmbed({
          title: '🕊️ Suas infrações foram perdoadas',
          description:
            `A moderação de **${guild.name}** revisou o seu caso.\n\n**Motivo:** ${reason}`,
          color: colors.success,
          fields: [{ name: 'O que foi feito', value: done.join('\n').slice(0, 1024) }],
        }),
      ],
    });
    return '📩 **Aviso na DM:** enviado.';
  } catch {
    return '📩 **Aviso na DM:** não foi possível enviar (DM fechada, ou o bot não divide servidor com o usuário).';
  }
}

/** Uma linha do histórico. */
function describeRow(row, expireMs, now) {
  const at = parseSqlDate(row.created_at);
  const label = RULES[row.rule_key]?.label ?? row.rule_key;
  const stamp = at ? `<t:${Math.floor(at.getTime() / 1000)}:R>` : 'data desconhecida';
  const expired = at && expireMs > 0 && now - at.getTime() > expireMs;
  const action = row.action && row.action !== 'none' ? ` · ${ACTIONS[row.action]?.label ?? row.action}` : '';

  return `${expired ? '⏳' : '•'} **${label}** (${row.points} pt${row.points === 1 ? '' : 's'}${expired ? ', vencido' : ''})${action}\n` +
    `└ ${stamp}${row.reason ? ` — ${row.reason}` : ''}`;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('infractions')
    .setDescription('Mostra os pontos e o histórico de infrações do AutoMod de um membro')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('Membro a consultar').setRequired(true))
    .addBooleanOption((opt) =>
      opt.setName('limpar').setDescription('Zera os pontos: apaga o histórico de infrações (irreversível)')
    )
    .addBooleanOption((opt) =>
      opt.setName('desfazer').setDescription('Remove o silenciamento e o banimento que o AutoMod aplicou')
    )
    .addStringOption((opt) =>
      opt
        .setName('motivo')
        .setDescription('Por que está perdoando — obrigatório para limpar ou desfazer')
        .setMaxLength(MAX_REASON)
    )
    .addBooleanOption((opt) =>
      opt.setName('avisar').setDescription('Mandar uma DM ao membro contando do perdão (padrão: não)')
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario', true);
    const shouldClear = interaction.options.getBoolean('limpar') ?? false;
    const shouldUndo = interaction.options.getBoolean('desfazer') ?? false;
    const reason = interaction.options.getString('motivo')?.trim() ?? '';
    const shouldNotify = interaction.options.getBoolean('avisar') ?? false;
    const guildId = interaction.guild.id;

    if (shouldClear || shouldUndo) {
      // O motivo é a razão de o perdão ser rastreável: sem ele o log diria quem
      // perdoou e o que apagou, mas não por quê — e é o "por quê" que se procura
      // meses depois. Por isso ele bloqueia a ação em vez de virar "não informado".
      if (!reason) {
        return respond(interaction, {
          embeds: [
            errorEmbed(
              'Informe o `motivo` para confirmar o perdão. Ele vai para o canal de logs, para o audit ' +
                'log do Discord e (se você pedir `avisar:true`) para a DM do membro.',
              '📝 Motivo obrigatório'
            ),
          ],
        });
      }

      const parts = [];

      if (shouldClear) {
        const removed = clearInfractions(guildId, user.id);
        parts.push(`🧹 **Pontos:** ${removed} infração(ões) apagadas, pontuação de volta a zero.`);
      }

      const undone = shouldUndo
        ? await undoPunishments(interaction.guild, user, interaction.member, reason)
        : null;
      if (undone) parts.push(...undone.lines);

      // A DM vai depois de tudo aplicado, para contar o que aconteceu de fato em
      // vez do que se pretendia fazer.
      const notice = shouldNotify ? await notifyPardon(interaction.guild, user, reason, parts) : null;

      // O log só faz sentido quando algo mudou de fato: um "desfazer" que não
      // encontrou nada não é um evento de moderação.
      if (shouldClear || undone?.changed) {
        await logEvent(
          interaction.guild,
          `${emoji(interaction.guild, 'automod')} Infrações perdoadas`,
          `**Usuário:** ${user.tag} (${user.id})\n**Moderador:** ${interaction.user.tag}\n` +
            `**Motivo:** ${reason}\n\n${[...parts, notice].filter(Boolean).join('\n')}`,
          colors.success
        );
      }

      return respond(interaction, {
        embeds: [
          successEmbed(
            `**Motivo:** ${reason}\n\n${[...parts, notice].filter(Boolean).join('\n')}`,
            `🕊️ Perdão aplicado a ${user.tag}`
          ),
        ],
      });
    }

    const config = getAutomodConfig(guildId);
    const now = Date.now();
    const expireMs = config.pointsExpireHours * 3600_000;

    const points = activePoints(guildId, user.id, config.pointsExpireHours, now);
    const total = countInfractions(guildId, user.id);
    const rows = listInfractions(guildId, user.id, HISTORY_LIMIT);
    const step = ladderStep(config.ladder, points);

    const next = config.ladder.find((candidate) => candidate.points > points);

    const fields = [
      { name: 'Pontos válidos', value: `**${points}**`, inline: true },
      { name: 'Infrações registradas', value: `${total}`, inline: true },
      { name: 'Pontos vencem em', value: formatDuration(expireMs), inline: true },
      {
        name: 'Degrau atual da escada',
        value: step ? `${step.points} pts → ${ACTIONS[step.action].label}` : 'nenhum',
        inline: true,
      },
      {
        name: 'Próximo degrau',
        value: next ? `${next.points} pts → ${ACTIONS[next.action].label} (faltam ${next.points - points})` : '—',
        inline: true,
      },
    ];

    if (rows.length) {
      fields.push({
        name: `Últimas ${rows.length} de ${total}`,
        value: rows.map((row) => describeRow(row, expireMs, now)).join('\n').slice(0, 1024),
        inline: false,
      });
    }

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: `${emoji(interaction.guild, 'automod')} Infrações de ${user.tag}`,
          description: total
            ? 'As linhas com ⏳ já venceram e não contam para a escada, mas ficam no histórico.'
            : 'Nenhuma infração registrada por aqui.',
          color: points > 0 ? colors.warning : colors.success,
          thumbnail: user.displayAvatarURL(),
          fields,
          footer: `ID: ${user.id}`,
        }),
      ],
    });
  },
};
