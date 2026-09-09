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
const { ACTIONS, ACTION_SEVERITY } = require('../../config/automodRules');
const { MAX_MUTE_MS } = require('./config');
const { recordInfraction, activePoints, crossedStep } = require('./infractions');
const { forgetUser } = require('./tracker');

/** Um aviso por usuário e escopo nesta janela: num flood de 20 mensagens, 1 aviso. */
const NOTICE_COOLDOWN_MS = 10000;

const insertWarn = db.prepare(
  'INSERT INTO warns (guild_id, user_id, moderator_id, reason) VALUES (?, ?, ?, ?)'
);

/** `guildId:userId:escopo` -> timestamp do último aviso. */
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

/**
 * Já cabe outro aviso a este membro neste escopo?
 *
 * O escopo é o canal para o aviso público e a string `dm` para a DM. Separados
 * porque um flood espalhado por cinco canais deve render cinco recados públicos
 * (um por plateia) mas **uma** DM: a DM tem uma plateia só, e cinco cópias nela
 * seriam o bot floodando o infrator.
 *
 * @param {string} scope id do canal ou `'dm'`
 */
function canNotify(guildId, userId, scope, now = Date.now()) {
  const key = `${guildId}:${userId}:${scope}`;
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
 *
 * O cooldown vale para os dois alcances. Ele existe justamente por causa do
 * flood — e as regras de flood avisam por DM — então deixar a DM de fora dele
 * seria tirar a trava exatamente de onde ela é necessária.
 */
async function notify(message, rule, text) {
  if (rule.notify === 'none') return;

  const scope = rule.notify === 'dm' ? 'dm' : message.channel.id;
  if (!canNotify(message.guild.id, message.author.id, scope)) return;

  if (rule.notify === 'dm') {
    // DM fechada é comum e não é problema do bot.
    await message.author.send({ content: `**${message.guild.name}** · ${text}` }).catch(() => {});
    return;
  }

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

/**
 * Texto curto do que aconteceu, para o aviso ao infrator.
 *
 * O `deleted` é o resultado real da remoção, não a intenção da regra: dizer "sua
 * mensagem foi removida" com a mensagem ainda no canal — porque a regra não pede
 * remoção, ou porque o bot não conseguiu — deixa quem leu procurando o que não
 * saiu do lugar e faz o aviso parecer errado sobre tudo o mais que ele diz.
 *
 * @param {boolean} deleted se a mensagem realmente saiu
 */
function noticeText(violation, results, deleted) {
  const applied = results.filter((r) => r.ok && r.detail).map((r) => r.detail);
  const motive = violation.label.toLowerCase();
  const base = deleted ? `sua mensagem foi removida (${motive}).` : `sua mensagem infringe as regras (${motive}).`;
  return applied.length ? `${base} Você foi ${applied.join(' e ')}.` : base;
}

/**
 * Das duas ações que um evento pode gerar — a imediata da regra e a do degrau
 * cruzado — devolve a única que será aplicada: a mais grave.
 *
 * Empate em `mute` fica com o timeout mais longo, pelo mesmo motivo: aplicar os
 * dois só sobrescreveria um pelo outro, e o membro que chegou num degrau da
 * escada não deveria sair dele com menos tempo do que já tinha.
 */
function pickAction(immediate, ladder) {
  if (!ladder || ladder.action === 'none') return immediate;
  if (!immediate || immediate.action === 'none') return ladder;

  const byLadder = ACTION_SEVERITY[ladder.action] ?? 0;
  const byRule = ACTION_SEVERITY[immediate.action] ?? 0;

  if (byLadder !== byRule) return byLadder > byRule ? ladder : immediate;
  if (immediate.action !== 'mute') return ladder;

  return (ladder.muteMs ?? 0) >= (immediate.muteMs ?? 0) ? ladder : immediate;
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

  // Gravar antes de punir: a decisão de punição depende do total **já com** esta
  // infração somada, e o registro é o histórico do que o membro fez, não do que o
  // bot conseguiu fazer — ele fica mesmo que a punição falhe.
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

  // Escada: só entra em cena se a regra dá pontos e o evento cruzou um degrau.
  let step = null;
  let total = 0;

  if (rule.points > 0 && config.ladder.length) {
    total = activePoints(message.guild.id, member.id, config.pointsExpireHours);
    step = crossedStep(config.ladder, total - rule.points, total);
  }

  // Uma punição por evento: a mais grave entre a da regra e a do degrau.
  const chosen = pickAction({ action: rule.action, muteMs: rule.muteMs }, step);
  const fromLadder = chosen === step;
  const applied = await applyAction(
    member,
    chosen.action,
    chosen.muteMs,
    fromLadder ? `AutoMod: ${total} pontos de infração` : reason
  );

  const results = [applied];

  await notify(message, rule, noticeText(violation, results, deleted));

  // Esquece o histórico recente: sem isso a próxima mensagem do mesmo flood
  // dispararia a mesma regra outra vez, com pontos novos.
  if (chosen.action !== 'none') forgetUser(message.guild.id, member.id);

  const failures = results.filter((r) => !r.ok && r.detail);
  const fields = [
    { name: 'Membro', value: `${member} (\`${member.id}\`)`, inline: true },
    { name: 'Canal', value: `${message.channel}`, inline: true },
    { name: 'Regra', value: `${label} — ${detail}`, inline: false },
    {
      name: 'Consequências',
      value: [
        deleted ? 'mensagem apagada' : rule.deleteMessage ? 'não conseguiu apagar' : 'mensagem mantida',
        applied.ok && applied.detail
          ? `${applied.detail} ${fromLadder ? `(escada, degrau de ${step.points} pontos)` : '(ação da regra)'}`
          : null,
        rule.points > 0 ? `+${rule.points} ponto(s)${total ? ` (total: ${total})` : ''}` : null,
        // Sem isto, "a regra manda advertir e o log não fala em advertência"
        // pareceria falha do bot em vez da escolha de não punir duas vezes.
        fromLadder && rule.action !== 'none' && rule.action !== chosen.action
          ? `ação da regra (${ACTIONS[rule.action]?.label ?? rule.action}) absorvida pela escada`
          : null,
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

  return { deleted, applied, chosen, fromLadder, step, total };
}

module.exports = {
  NOTICE_COOLDOWN_MS,
  canNotify,
  automodLog,
  applyAction,
  pickAction,
  noticeText,
  enforce,
};
