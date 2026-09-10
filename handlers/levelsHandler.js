/**
 * Concessão de XP por mensagem.
 *
 * Roda em **toda** mensagem de servidor, depois do AutoMod, então a ordem das
 * checagens é barata → cara e sai o mais cedo possível: o caminho comum (servidor
 * sem Levels ligado) custa uma leitura de config e nada mais.
 *
 * Nada aqui lança para fora. O evento `messageCreate` atende outros handlers
 * depois deste, e uma falha de anúncio ou de cargo não pode nem derrubar o evento
 * nem desfazer o XP que já foi gravado — por isso o XP é gravado primeiro, e só
 * depois vêm as ações que dependem do Discord.
 */

const { getLevelsConfig, isChannelIgnored, isMemberIgnored } = require('../utils/levels/config');
const { inspectContent, rollXp } = require('../utils/levels/antiFarm');
const tracker = require('../utils/levels/tracker');
const { changeXp } = require('../utils/levels/service');
const { syncMemberRewards } = require('../utils/levels/rewards');

/**
 * Mensagem que nunca concede XP, seja qual for a config.
 *
 * Webhook entra aqui junto com bot: `message.webhookId` é o único jeito de
 * distinguir uma mensagem de webhook, e o autor dela não é um membro real a quem
 * dar progressão.
 */
function isIgnorable(message) {
  if (!message?.guild) return true;
  if (message.author?.bot || message.webhookId) return true;
  if (message.system) return true;
  return false;
}

/**
 * Canal onde o level-up é anunciado.
 *
 * O canal configurado pode ter sido apagado ou perdido a permissão do bot desde a
 * configuração. Nos dois casos o fallback é o canal da mensagem, que é onde o
 * membro está agora — melhor anunciar no lugar certo do que não anunciar.
 *
 * @returns {import('discord.js').TextBasedChannel|null}
 */
function resolveAnnounceChannel(message, config) {
  const fallback = message.channel;
  if (!config.announceChannelId) return fallback;

  const channel = message.guild.channels.cache.get(config.announceChannelId);
  if (!channel?.isTextBased()) return fallback;

  const me = message.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  // Permissão irresolvível (bot fora do cache) não é motivo para desistir: a
  // tentativa de envio é que decide, e ela já está dentro de um try/catch.
  if (perms && !perms.has(['ViewChannel', 'SendMessages'])) return fallback;

  return channel;
}

/**
 * Anuncia o novo nível.
 *
 * Uma única mensagem mesmo com salto de vários níveis: seis anúncios seguidos por
 * um `/set-level` seriam spam no canal.
 *
 * `allowedMentions` restrito ao autor: o texto é montado pelo bot, mas o canal de
 * destino é escolhido por um admin e não vale arriscar um ping de cargo.
 */
async function announceLevelUp(message, config, change) {
  const channel = resolveAnnounceChannel(message, config);
  if (!channel) return;

  const jumped = change.newLevel - change.previousLevel > 1;
  const text = jumped
    ? `🎉 ${message.author} avançou do nível **${change.previousLevel}** para o nível **${change.newLevel}**!`
    : `🎉 ${message.author} alcançou o nível **${change.newLevel}**!`;

  await channel.send({ content: text, allowedMentions: { users: [message.author.id] } });
}

/**
 * Processa uma mensagem para fins de XP.
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<import('../utils/levels/types').XpChange|null>} a alteração,
 *   ou null quando a mensagem não concedeu XP.
 */
async function handleMessageForLevels(message) {
  if (isIgnorable(message)) return null;

  try {
    const config = getLevelsConfig(message.guild.id);
    if (!config.enabled) return null;

    if (isChannelIgnored(config, message.channel)) return null;
    if (isMemberIgnored(config, message.member)) return null;

    const { eligible, signature } = inspectContent(message.content ?? '', config);
    if (!eligible) return null;

    const guildId = message.guild.id;
    const userId = message.author.id;
    const now = Date.now();

    if (tracker.isRepeat(guildId, userId, signature, config.repeatWindowSeconds, now)) return null;
    if (tracker.isOnCooldown(guildId, userId, now)) return null;

    const change = changeXp({
      guildId,
      userId,
      operation: 'add',
      amount: rollXp(config),
      source: 'message',
    });

    // Só depois de a gravação ter dado certo: marcar antes e falhar a escrita
    // custaria ao membro a mensagem inteira, sem XP e sem nova chance no minuto.
    tracker.markCooldown(guildId, userId, config.cooldownSeconds, now);
    tracker.rememberSignature(guildId, userId, signature, now);

    if (change.direction !== 'up') return change;

    // Daqui para baixo o XP já está gravado. Cada passo falha por conta própria.
    if (message.member) {
      const sync = await syncMemberRewards(message.member, config, change.newLevel, `Nível ${change.newLevel}`);
      if (sync.problems.length) {
        console.warn(`[levels] Recompensas em ${guildId}: ${sync.problems.join(' · ')}`);
      }
    }

    if (config.announceEnabled) {
      await announceLevelUp(message, config, change).catch((err) => {
        console.warn(`[levels] Falha ao anunciar level-up em ${guildId}: ${err.message}`);
      });
    }

    return change;
  } catch (err) {
    console.error(`[levels] Falha ao processar mensagem em ${message.guild?.id}:`, err.message);
    return null;
  }
}

module.exports = { isIgnorable, resolveAnnounceChannel, announceLevelUp, handleMessageForLevels };
