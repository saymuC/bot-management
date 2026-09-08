const { PermissionFlagsBits, ChannelType } = require('discord.js');

/** Permissões mínimas para o bot publicar um embed com anexo. */
const POST_EMBED_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

const POST_EMBED_PERMS_LABEL = 'Ver Canal, Enviar Mensagens, Inserir Links e Anexar Arquivos';

/** Tipos de canal aceitos como destino do /embed. */
const TEXT_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/** @returns {boolean} true se o bot pode publicar o embed no canal. */
function canPostEmbed(channel, guild) {
  return Boolean(channel?.permissionsFor(guild.members.me)?.has(POST_EMBED_PERMS));
}

/**
 * Resolve texto livre num canal do servidor: `<#id>`, id puro ou nome.
 * @returns {import('discord.js').GuildBasedChannel|null}
 */
function resolveTextChannel(guild, raw) {
  const input = String(raw ?? '').trim();
  if (!input) return null;

  const id = /^<#(\d+)>$/.exec(input)?.[1] ?? (/^\d{17,20}$/.test(input) ? input : null);
  if (id) {
    const byId = guild.channels.cache.get(id);
    return byId && TEXT_CHANNEL_TYPES.includes(byId.type) ? byId : null;
  }

  const name = input.replace(/^#/, '').toLowerCase();
  return (
    guild.channels.cache.find((channel) => TEXT_CHANNEL_TYPES.includes(channel.type) && channel.name.toLowerCase() === name) ?? null
  );
}

module.exports = { POST_EMBED_PERMS, POST_EMBED_PERMS_LABEL, TEXT_CHANNEL_TYPES, canPostEmbed, resolveTextChannel };
