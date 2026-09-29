// @ts-check
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { emoji } = require('../../utils/emojis');
const { respond } = require('../../utils/interactions');

const PERMISSION_LABELS = Object.freeze({
  Administrator: 'Administrador',
  AddReactions: 'Adicionar reações',
  AttachFiles: 'Anexar arquivos',
  BanMembers: 'Banir membros',
  BypassSlowmode: 'Ignorar modo lento',
  ChangeNickname: 'Alterar próprio apelido',
  Connect: 'Conectar a canais de voz',
  CreateEvents: 'Criar eventos',
  CreateGuildExpressions: 'Criar emojis e figurinhas',
  CreateInstantInvite: 'Criar convites',
  CreatePrivateThreads: 'Criar tópicos privados',
  CreatePublicThreads: 'Criar tópicos públicos',
  DeafenMembers: 'Ensurdecer membros',
  EmbedLinks: 'Incorporar links',
  KickMembers: 'Expulsar membros',
  ManageChannels: 'Gerenciar canais',
  ManageEvents: 'Gerenciar eventos',
  ManageGuild: 'Gerenciar servidor',
  ManageGuildExpressions: 'Gerenciar emojis e figurinhas',
  ManageMessages: 'Gerenciar mensagens',
  ManageNicknames: 'Gerenciar apelidos',
  ManageRoles: 'Gerenciar cargos',
  ManageThreads: 'Gerenciar tópicos',
  ManageWebhooks: 'Gerenciar webhooks',
  MentionEveryone: 'Mencionar @everyone e @here',
  ModerateMembers: 'Moderar membros',
  MoveMembers: 'Mover membros em canais de voz',
  MuteMembers: 'Silenciar membros em canais de voz',
  PinMessages: 'Fixar mensagens',
  PrioritySpeaker: 'Prioridade de fala',
  ReadMessageHistory: 'Ver histórico de mensagens',
  RequestToSpeak: 'Solicitar fala em palco',
  SendMessages: 'Enviar mensagens',
  SendMessagesInThreads: 'Enviar mensagens em tópicos',
  SendPolls: 'Criar enquetes',
  SendTTSMessages: 'Enviar mensagens TTS',
  SendVoiceMessages: 'Enviar mensagens de voz',
  SetVoiceChannelStatus: 'Alterar status do canal de voz',
  ManageEmojisAndStickers: 'Gerenciar emojis e figurinhas',
  Speak: 'Falar em canais de voz',
  Stream: 'Transmitir vídeo',
  UseApplicationCommands: 'Usar comandos de aplicativo',
  UseEmbeddedActivities: 'Usar atividades',
  UseExternalApps: 'Usar aplicativos externos',
  UseExternalEmojis: 'Usar emojis externos',
  UseExternalSounds: 'Usar sons externos',
  UseExternalStickers: 'Usar figurinhas externas',
  UseSoundboard: 'Usar soundboard',
  UseVAD: 'Usar detecção de voz',
  ViewAuditLog: 'Ver registro de auditoria',
  ViewChannel: 'Ver canais',
  ViewCreatorMonetizationAnalytics: 'Ver análises de monetização',
  ViewGuildInsights: 'Ver insights do servidor',
});

/** @type {readonly (readonly [import('discord.js').UserFlagsString, string])[]} */
const USER_FLAGS = Object.freeze([
  ['Staff', 'Equipe do Discord'],
  ['Partner', 'Parceiro do Discord'],
  ['Hypesquad', 'HypeSquad Events'],
  ['BugHunterLevel1', 'Caçador de bugs nível 1'],
  ['BugHunterLevel2', 'Caçador de bugs nível 2'],
  ['HypeSquadOnlineHouse1', 'Casa Bravery'],
  ['HypeSquadOnlineHouse2', 'Casa Brilliance'],
  ['HypeSquadOnlineHouse3', 'Casa Balance'],
  ['PremiumEarlySupporter', 'Apoiador pioneiro'],
  ['VerifiedDeveloper', 'Desenvolvedor verificado'],
  ['CertifiedModerator', 'Moderador certificado'],
  ['ActiveDeveloper', 'Desenvolvedor ativo'],
]);

/** @param {string|null} value */
function parseMemberId(value) {
  const match = /^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(String(value ?? '').trim());
  return match?.[1] ?? match?.[2] ?? null;
}

/** @param {import('discord.js').GuildMember} member */
function memberRoles(member) {
  return member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((a, b) => b.position - a.position);
}

/** @param {import('discord.js').GuildMember} member */
function buildMemberInfo(member) {
  const { user, guild } = member;
  const roles = memberRoles(member);
  const highestRole = roles.first();
  const flags = user.flags?.toArray() ?? [];
  const curiosity = USER_FLAGS.find(([flag]) => flags.includes(flag))?.[1]
    ?? (user.bot ? 'Conta de bot' : member.premiumSince ? 'Apoiador deste servidor' : 'Ainda sem curiosidade pública');

  return baseEmbed({
    title: `${emoji(guild, 'user_info')} Perfil de ${member.displayName}`,
    description: `Informações de ${user} neste servidor.`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    fields: [
      { name: `${emoji(guild, 'user_name')} Nome`, value: user.username, inline: true },
      { name: `${emoji(guild, 'user_id')} ID do Discord`, value: `\`${user.id}\``, inline: true },
      {
        name: `${emoji(guild, 'user_tag')} Apelido no servidor`,
        value: member.nickname ?? 'Sem apelido',
        inline: true,
      },
      {
        name: `${emoji(guild, 'user_primary_guild')} Servidor principal`,
        value: user.primaryGuild?.identityEnabled ? user.primaryGuild.tag ?? 'Tag indisponível' : 'Não informado',
        inline: true,
      },
      { name: `${emoji(guild, 'user_created')} Conta criada`, value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>\n<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: `${emoji(guild, 'user_joined')} Entrou no servidor`, value: member.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>\n<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
        : 'Data indisponível', inline: true },
      { name: `${emoji(guild, 'user_highest_role')} Maior cargo`, value: highestRole ? `${highestRole}` : 'Sem cargos', inline: true },
      { name: `${emoji(guild, 'user_curiosity')} Curiosidade`, value: curiosity, inline: false },
      { name: `${emoji(guild, 'user_roles')} Cargos`, value: roles.size ? `${roles.size} cargo${roles.size === 1 ? '' : 's'}` : 'Nenhum cargo adicional', inline: true },
    ],
    footer: `Servidor: ${guild.name}`,
  });
}

/** @param {import('discord.js').GuildMember} member */
function buildPermissionsEmbeds(member) {
  const permissions = member.permissions.toArray();
  const effectivePermissions = permissions.includes('Administrator') ? Object.keys(PermissionFlagsBits) : permissions;
  const permissionLines = effectivePermissions.length
    ? effectivePermissions.map((permission) => `• ${PERMISSION_LABELS[permission] ?? permission}`)
    : ['Nenhuma permissão concedida.'];
  const permissionPages = Array.from(
    { length: Math.ceil(permissionLines.length / 20) },
    (_, index) => permissionLines.slice(index * 20, index * 20 + 20)
  );
  const roles = memberRoles(member).map((role) => `• <@&${role.id}>`);
  const roleChunks = Array.from({ length: Math.ceil(roles.length / 40) }, (_, index) => roles.slice(index * 40, index * 40 + 40));
  if (!roleChunks.length) roleChunks.push(['Nenhum cargo adicional.']);

  return [
    ...permissionPages.map((lines, index) => baseEmbed({
      title: `${emoji(member.guild, 'user_permissions')} Permissões de ${member.displayName}`,
      description: `Permissões efetivas (${effectivePermissions.length}):\n${lines.join('\n')}`,
      thumbnail: member.user.displayAvatarURL({ size: 128 }),
      footer: `${member.guild.name} • permissões ${index + 1}/${permissionPages.length}`,
    })),
    ...roleChunks.map((lines, index) => baseEmbed({
      title: `${emoji(member.guild, 'user_roles')} Cargos de ${member.displayName}`,
      description: lines.join('\n'),
      footer: `${member.guild.name} • ${index + 1}/${roleChunks.length}`,
    })),
  ];
}

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('user')
    .setDescription('Consulta informações de um usuário do servidor')
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('info')
        .setDescription('Mostra o perfil, avatar, permissões e cargos de um usuário')
        .addUserOption((option) => option.setName('usuario').setDescription('Selecione um usuário'))
        .addStringOption((option) =>
          option.setName('id').setDescription('ID da conta do usuário')
        )
    ),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return respond(interaction, { embeds: [errorEmbed('Este comando só pode ser usado em um servidor.')] });

    const rawId = interaction.options.getString('id');
    const selectedUser = interaction.options.getUser('usuario');

    if (rawId && selectedUser) {
      return respond(interaction, { embeds: [errorEmbed('Use `usuario` ou `id`, não os dois.')] });
    }

    const userId = rawId ? parseMemberId(rawId) : selectedUser?.id ?? interaction.user.id;
    if (!userId) {
      return respond(interaction, { embeds: [errorEmbed('Informe um ID válido (17 a 20 dígitos).')] });
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      return respond(interaction, { embeds: [errorEmbed('Esse usuário não foi encontrado neste servidor.')] });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`userinfo_avatar_${member.id}`)
        .setLabel('Ver avatar')
        .setEmoji(emoji(guild, 'user_avatar'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`userinfo_permissions_${member.id}`)
        .setLabel('Permissões e cargos')
        .setEmoji(emoji(guild, 'user_permissions'))
        .setStyle(ButtonStyle.Primary)
    );

    return respond(interaction, {
      embeds: [buildMemberInfo(member)],
      components: [row],
    });
  },

  parseMemberId,
  PERMISSION_LABELS,
  buildMemberInfo,
  buildPermissionsEmbeds,
  /** @param {import('discord.js').GuildMember} member */
  buildAvatarEmbed(member) {
    return baseEmbed({
      title: `${emoji(member.guild, 'user_avatar')} Avatar de ${member.displayName}`,
      image: member.user.displayAvatarURL({ extension: 'png', size: 4096 }),
      footer: `Solicitado no servidor ${member.guild.name}`,
    });
  },
};
