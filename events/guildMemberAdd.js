const { Events } = require('discord.js');
const { getGuildConfig } = require('../database/db');
const { logEvent } = require('../utils/logger');
const { colors } = require('../config/settings');
const { getWelcomeConfig, buildWelcomeMessage } = require('../utils/welcomeConfig');
const { emoji } = require('../utils/emojis');
const { getAutomodConfig } = require('../utils/automod/config');
const { inspectJoin } = require('../utils/automod/raid');

/**
 * Passa a entrada pelo anti-raid antes de qualquer outra coisa.
 *
 * Bots ficam de fora: quem os adicionou já precisou de permissão para isso, e
 * uma conta de bot é sempre "nova e sem avatar" para os critérios de suspeita.
 *
 * Qualquer falha aqui não pode impedir o autorole e as boas-vindas — o AutoMod é
 * um extra, não um pré-requisito para o servidor funcionar.
 */
async function screenJoin(member) {
  const fallback = { suppressAutorole: false, suppressWelcome: false };
  if (member.user.bot) return fallback;

  const automod = getAutomodConfig(member.guild.id);
  if (!automod.enabled) return fallback;

  return inspectJoin(member, automod).catch((err) => {
    console.error('[automod] Falha ao avaliar entrada:', err.message);
    return fallback;
  });
}

/** Envia a mensagem de boas-vindas conforme o painel do /setup-welcome. */
async function sendWelcome(member) {
  const config = getWelcomeConfig(member.guild.id);
  if (!config.enabled || !config.channelId) return;

  const channel = await member.guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  await channel
    .send(buildWelcomeMessage(config, member))
    .catch((err) => console.error('[welcome] Falha:', err.message));
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    const config = getGuildConfig(member.guild.id);

    // Anti-raid primeiro: dar cargo e anunciar boas-vindas a quem vai ser
    // expulso no instante seguinte só polui o canal.
    const { suppressAutorole, suppressWelcome } = await screenJoin(member);

    // autorole
    if (config?.autorole_id && !suppressAutorole) {
      await member.roles
        .add(config.autorole_id, 'Autorole configurado')
        .catch((err) => console.error('[autorole] Falha:', err.message));
    }

    if (!suppressWelcome) await sendWelcome(member);

    await logEvent(
      member.guild,
      `${emoji(member.guild, 'member_join')} Membro entrou`,
      `${member.user.tag} (${member.id}) entrou no servidor.`,
      colors.success
    );
  },
};
