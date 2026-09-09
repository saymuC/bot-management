/**
 * Execução das consequências de uma violação: apagar, avisar, registrar, punir.
 *
 * Toda ação é tentada com guarda de hierarquia e falha por escrito no log de
 * moderação em vez de virar exceção engolida — "o AutoMod não fez nada e ninguém
 * sabe por quê" é o pior desfecho possível aqui.
 */

const { PermissionFlagsBits } = require('discord.js');
const { db } = require('../../database/db');
const { logEvent } = require('../logger');
const { baseEmbed } = require('../embeds');
const { emoji } = require('../emojis');
const { colors } = require('../../config/settings');
const { formatDuration } = require('../time');
const { ACTIONS } = require('../../config/automodRules');
const { MAX_MUTE_MS } = require('./config');
const { recordInfraction, activePoints, ladderStep } = require('./infractions');
const { forgetUser } = require('./tracker');

/** Um aviso por usuário+canal nesta janela: num flood de 20 mensagens, 1 aviso. */
const NOTICE_COOLDOWN_MS = 10000;

const insertWarn = db.prepare(
  'INSERT INTO warns (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)'
);

/** `guildId:userId:channelId` -> timestamp do último aviso. */
const noticeCooldown = new Map();

/** Limpeza do Map de cooldown, para ele não crescer indefinidamente. */
const cooldownSweeper = setInterval(() => {
  const cutoff = Date.now() - NOTICE_COOLDOWN_MS;
  for (const [key, at] of noticeCooldown) if (at < cutoff) noticeCooldown.delete(key);
}, 60_000);
cooldownSweeper.unref();

/**
 * Log do AutoMod: no canal próprio, se houver, senão no canal de logs geral.
 *
 * Um canal separado importa aqui porque o AutoMod é o que mais escreve no log —
 * misturado com ban e ticket, afogaria o resto.
 */
async function automodLog(guild, config, title, description, color, fields) {
  if (!config.logChannelId) return logEvent(guild, title, description, color, fields);

  const channel = await guild.channels.fetch(config.logChannelId).catch(() => null);
  // Canal apagado ou sem acesso: cai no log geral em vez de perder o registro.
  if (!channel?.isTextBased()) return logEvent(guild, title, description, color, fields);

  return channel
    .send({ embeds: [baseEmbed({ title, description, color, fields })], allowedMentions: { parse: [] } })
    .catch((err) => console.error(`[automod] Falha ao logar em ${config.logChannelId}:`, err.message));
}

function canNotify(guildId, userId, channelId, now = Date.now()) {
  const key = `${guildId}:${userId}:${channelId}`;
  if (now - (noticeCooldown.get(key) ?? 0) < NOTICE_COOLDOWN_MS) return false;
  noticeCooldown.set(key, now);
  return true;
}

/** Apaga a mensagem, se a regra pedir e o bot puder. */
async function deleteMessage(message, rule) {
  if (!rule.deleteMessage || !message.deletable) return false;

  const me = message.guild.members.me;
  if (!message.channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) return false;

  // Pode ter sido apagada por outro caminho no meio disso; não é erro.
  return message.delete().then(() => true).catch(() => false);
}

/**
 * Avisa o infrator: no canal, onde todos veem, ou na DM, onde só ele vê.
 *
 * O aviso no canal **não se apaga sozinho** a menos que a regra tenha um prazo
 * configurado (`noticeTtlMs`). O padrão é ficar: uma mensagem que desaparece sem
 * ninguém ter pedido não dá para reler nem para conferir depois.
 */
async function notify(message, rule, text) {
  if (rule.notify === 'none') return;

  if (rule.notify === 'dm') {
    // DM fechada é comum e não é problema do bot.
    await message.author.send({ content: `**${message.guild.name}** · ${text}` }).catch(() => {});
    return;
  }

  if (!canNotify(message.guild.id, message.author.id, message.channel.id)) return;

  const sent = await message.channel
    .send({ content: `${message.author}, ${text}`, allowedMentions: { users: [message.author.id] } })
    .catch(() => null);

  if (sent && rule.noticeTtlMs > 0) {
    setTimeout(() => sent.delete().catch(() => {}), rule.noticeTtlMs).unref?.();
  }
}

/**
 * Aplica uma ação a um membro.
 * @returns {{ ok: boolean, detail: string }}
 */
async function applyAction(member, action, muteMs, reason) {
  if (!action || action === 'none') return { ok: true, detail: '' };

  if (action === 'warn') {
    // moderator_id = o próprio bot, para o /warnings mostrar de onde veio.
    insertWarn.run(member.guild.id, member.id, member.client.user.id, reason);
    return { ok: true, detail: 'advertido' };
  }

  if (action === 'mute') {
    if (!member.moderatable) return { ok: false, detail: 'sem hierarquia para silenciar' };
    const duration = Math.min(Math.max(muteMs, 1000), MAX_MUTE_MS);
    const done = await member.timeout(duration, reason).then(() => true).catch(() => false);
    return done
      ? { ok: true, detail: `silenciado por ${formatDuration(duration)}` }
      : { ok: false, detail: 'o Discord recusou o timeout' };
  }

  if (action === 'kick') {
    if (!member.kickable) return { ok: false, detail: 'sem hierarquia para expulsar' };
    const done = await member.kick(reason).then(() => true).catch(() => false);
    return done ? { ok: true, detail: 'expulso' } : { ok: false, detail: 'o Discord recusou a expulsão' };
  }

  if (action === 'ban') {
    if (!member.bannable) return { ok: false, detail: 'sem hierarquia para banir' };
    const done = await member.ban({ reason }).then(() => true).catch(() => false);
    return done ? { ok: true, detail: 'banido' } : { ok: false, detail: 'o Discord recusou o banimento' };
  }

  return { ok: false, detail: `ação desconhecida: ${action}` };
}

/** Texto curto do que aconteceu, para o aviso ao infrator. */
function noticeText(violation, results) {
  const applied = results.filter((r) => r.ok && r.detail).map((r) => r.detail);
  const base = `sua mensagem foi removida (${violation.label.toLowerCase()}).`;
  return applied.length ? `${base} Você foi ${applied.join(' e ')}.` : base;
}

/**
 * Executa tudo o que a violação implica.
 *
 * @param {import('discord.js').Message} message
 * @param {{ key: string, rule: object, label: string, detail: string }} violation
 * @param {object} config config normalizada do servidor
 */
async function enforce(message, violation, config) {
  const { rule, label, detail, key } = violation;
  const member = message.member;
  const reason = `AutoMod: ${label} — ${detail}`;

  const deleted = await deleteMessage(message, rule);

  const immediate = await applyAction(member, rule.action, rule.muteMs, reason);

  // A infração é gravada mesmo quando a ação falha: o registro é o histórico do
  // que o membro fez, não do que o bot conseguiu fazer.
  recordInfraction({
    guildId: message.guild.id,
    userId: member.id,
    ruleKey: key,
    points: rule.points,
    reason: detail,
    excerpt: message.content,
    channelId: message.channel.id,
    action: rule.action,
  });

  // Escada: só entra em cena se a regra dá pontos.
  const results = [immediate];
  let step = null;
  let total = 0;

  if (rule.points > 0 && config.ladder.length) {
    total = activePoints(message.guild.id, member.id, config.pointsExpireHours);
    step = ladderStep(config.ladder, total);

    // Ação da escada igual à imediata seria punir duas vezes pelo mesmo evento.
    if (step && step.action !== rule.action) {
      results.push(await applyAction(member, step.action, step.muteMs, `AutoMod: ${total} pontos de infração`));
    }
  }

  await notify(message, rule, noticeText(violation, results));

  // Esquece o histórico recente: sem isso a próxima mensagem do mesmo flood
  // dispararia a mesma regra outra vez, com pontos novos.
  if (rule.action !== 'none' || step) forgetUser(message.guild.id, member.id);

  const failures = results.filter((r) => !r.ok && r.detail);
  const fields = [
    { name: 'Membro', value: `${member} (\`${member.id}\`)`, inline: true },
    { name: 'Canal', value: `${message.channel}`, inline: true },
    { name: 'Regra', value: `${label} — ${detail}`, inline: false },
    {
      name: 'Consequências',
      value: [
        deleted ? 'mensagem apagada' : rule.deleteMessage ? 'não conseguiu apagar' : 'mensagem mantida',
        immediate.ok && immediate.detail ? immediate.detail : null,
        rule.points > 0 ? `+${rule.points} ponto(s)${total ? ` (total: ${total})` : ''}` : null,
        step ? `escada em ${step.points} pontos: ${ACTIONS[step.action]?.label ?? step.action}` : null,
        ...failures.map((f) => `⚠️ ${f.detail}`),
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    },
  ];

  if (message.content) {
    fields.push({ name: 'Conteúdo', value: `\`\`\`${message.content.slice(0, 900)}\`\`\``, inline: false });
  }

  await automodLog(
    message.guild,
    config,
    `${emoji(message.guild, 'automod')} AutoMod`,
    `Violação de **${label}** detectada.`,
    failures.length ? colors.warning : colors.error,
    fields
  );

  return { deleted, immediate, step, total };
}

module.exports = {
  NOTICE_COOLDOWN_MS,
  canNotify,
  automodLog,
  applyAction,
  noticeText,
  enforce,
};
