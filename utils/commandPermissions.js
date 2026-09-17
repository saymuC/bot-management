// @ts-check
/**
 * Permissões dos comandos do bot, em três camadas.
 *
 * O problema que isto resolve: liberar um comando para a staff exigia dar uma
 * permissão nativa do Discord (`setDefaultMemberPermissions`) que vale para o
 * servidor inteiro — quem podia usar `/clear` ganhava "Gerenciar Mensagens" em
 * todo canal. Aqui o bot passa a decidir sozinho, por cargo:
 *
 *   1. grupo de comandos  — configuração rápida ("Moderação: @Staff");
 *   2. comando individual — ajuste fino em cima do grupo;
 *   3. `admin_only`       — trava que cargo nenhum destrava.
 *
 * Compatibilidade: servidor sem nada configurado cai na permissão nativa antiga
 * do comando (`LEGACY_PERMISSION`), então o primeiro deploy não muda quem já
 * usava o bot.
 *
 * @typedef {'inherit'|'custom'|'admin_only'} PermissionMode
 * @typedef {{ mode: PermissionMode, roleIds: string[] }} CommandOverride
 * @typedef {{ groups: Record<string, string[]>, commands: Record<string, CommandOverride> }} CommandPermissions
 */

const { PermissionFlagsBits } = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('../database/db');

/** Coluna de `guild_config` onde o JSON mora. */
const CONFIG_FIELD = 'command_permissions';

/** Id de cargo do Discord. Só entra na configuração o que casa com isto. */
const SNOWFLAKE_RE = /^\d{17,21}$/;

/** @type {readonly PermissionMode[]} */
const MODES = Object.freeze(['inherit', 'custom', 'admin_only']);

/**
 * Teto de cargos por grupo/comando. É o mesmo limite do RoleSelectMenu do
 * painel: sem o corte aqui, uma configuração vinda de fora do painel poderia
 * guardar mais cargos do que o painel consegue mostrar de volta.
 */
const MAX_ROLES = 10;

/** Resposta única de recusa — usada no gate central e nos painéis. */
const PERMISSION_DENIED_MESSAGE = 'Você não tem permissão para usar este comando.';

/**
 * Catálogo: grupo -> comandos, e a permissão nativa que cada comando exigia
 * antes deste sistema (o fallback da regra 6).
 *
 * Esta é a fonte de verdade em tempo de execução. Os comandos declaram
 * `permissionGroup`/`requiredPermission` para quem lê o arquivo saber a que
 * grupo pertencem; `test/commandPermissions.catalog.test.js` garante que os dois
 * lados não divirjam.
 *
 * `emoji` é a chave do registro de emojis (utils/emojis.js), não o emoji.
 */
const GROUPS = Object.freeze({
  config: {
    label: 'Configuração',
    emoji: 'config_center',
    description: 'Painéis de configuração do servidor',
    commands: Object.freeze({
      config: PermissionFlagsBits.Administrator,
      automod: PermissionFlagsBits.Administrator,
      'setup-welcome': PermissionFlagsBits.Administrator,
      'setup-logs': PermissionFlagsBits.Administrator,
      'setup-verify': PermissionFlagsBits.Administrator,
      'bot-status': PermissionFlagsBits.Administrator,
      'config-emojis': PermissionFlagsBits.Administrator,
      'emoji-add': PermissionFlagsBits.ManageGuildExpressions,
      'pull-user': PermissionFlagsBits.Administrator,
    }),
  },
  moderation: {
    label: 'Moderação',
    emoji: 'automod',
    description: 'Ban, kick, mute, warns e limpeza',
    commands: Object.freeze({
      ban: PermissionFlagsBits.BanMembers,
      kick: PermissionFlagsBits.KickMembers,
      mute: PermissionFlagsBits.ModerateMembers,
      warn: PermissionFlagsBits.ModerateMembers,
      warnings: PermissionFlagsBits.ModerateMembers,
      infractions: PermissionFlagsBits.ModerateMembers,
      'automod-test': PermissionFlagsBits.ManageGuild,
      clear: PermissionFlagsBits.ManageMessages,
    }),
  },
  tickets: {
    label: 'Tickets',
    emoji: 'ticket',
    description: 'Configuração e relatórios de atendimento',
    commands: Object.freeze({
      'ticket-config': PermissionFlagsBits.Administrator,
      'ticket-stats': PermissionFlagsBits.ManageMessages,
    }),
  },
  levels: {
    label: 'Níveis',
    emoji: 'rank',
    description: 'XP, recompensas e ajustes manuais',
    commands: Object.freeze({
      levelconfig: PermissionFlagsBits.ManageGuild,
      'add-xp': PermissionFlagsBits.ManageGuild,
      'remove-xp': PermissionFlagsBits.ManageGuild,
      'set-level': PermissionFlagsBits.ManageGuild,
      'reset-xp': PermissionFlagsBits.ManageGuild,
    }),
  },
  giveaways: {
    label: 'Sorteios',
    emoji: 'giveaway',
    description: 'Criar, encerrar e sortear de novo',
    commands: Object.freeze({
      'giveaway-start': PermissionFlagsBits.ManageGuild,
      'giveaway-end': PermissionFlagsBits.ManageGuild,
      'giveaway-stop': PermissionFlagsBits.ManageGuild,
      'giveaway-reroll': PermissionFlagsBits.ManageGuild,
    }),
  },
  messages: {
    label: 'Mensagens',
    emoji: 'message_edit',
    description: 'Falar pelo bot, embeds e recriar canal',
    commands: Object.freeze({
      say: PermissionFlagsBits.ManageMessages,
      embed: PermissionFlagsBits.ManageMessages,
      nuke: PermissionFlagsBits.ManageChannels,
    }),
  },
  roles: {
    label: 'Cargos',
    emoji: 'reaction_role',
    description: 'Cargo automático e autoatribuição',
    commands: Object.freeze({
      'setup-autorole': PermissionFlagsBits.ManageRoles,
      'reactionrole-setup': PermissionFlagsBits.ManageRoles,
    }),
  },
});

/** @type {readonly string[]} */
const GROUP_KEYS = Object.freeze(Object.keys(GROUPS));

/** comando -> grupo. Achatado uma vez, na carga do módulo. */
const COMMAND_GROUP = Object.freeze(
  Object.fromEntries(
    GROUP_KEYS.flatMap((group) => Object.keys(GROUPS[group].commands).map((name) => [name, group]))
  )
);

/** comando -> permissão nativa antiga (fallback da regra 6). */
const LEGACY_PERMISSION = Object.freeze(
  Object.fromEntries(
    GROUP_KEYS.flatMap((group) => Object.entries(GROUPS[group].commands))
  )
);

/**
 * Comandos que o painel destaca como travávéis em "Somente Administrator" —
 * são os que expõem o servidor inteiro ou destroem coisa (`/nuke`).
 */
const ADMIN_LOCKABLE = Object.freeze([
  'config',
  'bot-status',
  'pull-user',
  'nuke',
  'ban',
  'ticket-config',
  'automod',
  'setup-verify',
  'setup-welcome',
  'config-emojis',
]);

/**
 * Padrão de fábrica: os quatro em que um erro de configuração custa o servidor
 * inteiro já nascem travados. O servidor destrava trocando o modo no painel.
 */
const ADMIN_ONLY_DEFAULTS = Object.freeze(new Set(['config', 'bot-status', 'pull-user', 'nuke']));

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON quebrado (edição manual do banco) não deve derrubar o gate. */
function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @returns {string[]} ids válidos, sem repetição e dentro do teto. */
function normalizeRoleIds(raw) {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((id) => typeof id === 'string' && SNOWFLAKE_RE.test(id));
  return [...new Set(valid)].slice(0, MAX_ROLES);
}

/**
 * Deixa qualquer entrada na forma esperada. Tudo que não reconhece cai fora em
 * silêncio: uma configuração meio inválida vira a configuração padrão daquele
 * pedaço, nunca uma exceção no meio de uma interação.
 *
 * Duas normalizações que valem explicação:
 *   - `inherit` não é guardado, porque é justamente a ausência de override;
 *   - `custom` sem cargo nenhum viraria um comando que ninguém além de admin
 *     usa, o que é o `admin_only` escrito por acidente — então volta a herdar.
 *
 * @param {unknown} raw JSON em texto (como vem do banco) ou objeto.
 * @returns {CommandPermissions}
 */
function normalizeCommandPermissions(raw) {
  const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
  const source = isPlainObject(parsed) ? parsed : {};
  const rawGroups = isPlainObject(source.groups) ? source.groups : {};
  const rawCommands = isPlainObject(source.commands) ? source.commands : {};

  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const group of GROUP_KEYS) groups[group] = normalizeRoleIds(rawGroups[group]);

  /** @type {Record<string, CommandOverride>} */
  const commands = {};
  for (const [name, override] of Object.entries(rawCommands)) {
    // Comando que saiu do catálogo (renomeado, removido) não volta ao arquivo.
    if (!Object.hasOwn(COMMAND_GROUP, name)) continue;
    if (!isPlainObject(override)) continue;

    const mode = MODES.includes(/** @type {PermissionMode} */ (override.mode))
      ? /** @type {PermissionMode} */ (override.mode)
      : 'inherit';
    const roleIds = normalizeRoleIds(override.roleIds);

    if (mode === 'inherit') continue;
    if (mode === 'custom' && roleIds.length === 0) continue;

    commands[name] = { mode, roleIds: mode === 'custom' ? roleIds : [] };
  }

  return { groups, commands };
}

/**
 * Configuração do servidor, já normalizada.
 * @param {string} guildId
 * @returns {CommandPermissions}
 */
function getCommandPermissions(guildId) {
  return normalizeCommandPermissions(getGuildConfig(guildId)?.[CONFIG_FIELD]);
}

/**
 * Grava a configuração (normalizada de novo antes de ir ao banco).
 * @param {string} guildId
 * @param {unknown} config
 * @returns {CommandPermissions} o que ficou salvo.
 */
function saveCommandPermissions(guildId, config) {
  const normalized = normalizeCommandPermissions(config);
  setGuildConfig(guildId, CONFIG_FIELD, JSON.stringify(normalized));
  return normalized;
}

/**
 * Troca os cargos de um grupo. Grupo desconhecido é ignorado.
 * @param {string} guildId
 * @param {string} group
 * @param {string[]} roleIds
 * @returns {CommandPermissions}
 */
function setGroupRoles(guildId, group, roleIds) {
  const current = getCommandPermissions(guildId);
  if (!Object.hasOwn(GROUPS, group)) return current;
  return saveCommandPermissions(guildId, {
    ...current,
    groups: { ...current.groups, [group]: normalizeRoleIds(roleIds) },
  });
}

/**
 * Define o override de um comando. `inherit` (ou `custom` sem cargos) apaga o
 * override, que é o mesmo efeito de herdar do grupo.
 * @param {string} guildId
 * @param {string} commandName
 * @param {{ mode: PermissionMode, roleIds?: string[] }} override
 * @returns {CommandPermissions}
 */
function setCommandOverride(guildId, commandName, override) {
  const current = getCommandPermissions(guildId);
  if (!Object.hasOwn(COMMAND_GROUP, commandName)) return current;

  const commands = { ...current.commands, [commandName]: { mode: override.mode, roleIds: override.roleIds ?? [] } };
  return saveCommandPermissions(guildId, { ...current, commands });
}

/**
 * Remove o override: o comando volta a seguir o grupo.
 * @param {string} guildId
 * @param {string} commandName
 * @returns {CommandPermissions}
 */
function clearCommandOverride(guildId, commandName) {
  const current = getCommandPermissions(guildId);
  const { [commandName]: _removed, ...commands } = current.commands;
  return saveCommandPermissions(guildId, { ...current, commands });
}

/**
 * Override que vale para o comando, contando o padrão de fábrica.
 * @param {CommandPermissions} config
 * @param {string} commandName
 * @returns {CommandOverride|null}
 */
function effectiveOverride(config, commandName) {
  if (config.commands[commandName]) return config.commands[commandName];
  if (ADMIN_ONLY_DEFAULTS.has(commandName)) return { mode: 'admin_only', roleIds: [] };
  return null;
}

/** Nome do comando, aceitando o módulo do comando ou só o nome. */
function commandNameOf(command) {
  if (typeof command === 'string') return command;
  return command?.data?.name ?? command?.name ?? '';
}

const hasAnyRole = (member, roleIds) => roleIds.some((id) => Boolean(member?.roles?.cache?.has(id)));

/** Regra 6: a permissão nativa que o comando exigia antes deste sistema. */
function legacyAllows(interaction, commandName) {
  const legacy = LEGACY_PERMISSION[commandName];
  if (!legacy) return true;
  return Boolean(interaction.memberPermissions?.has(legacy));
}

/**
 * O membro pode usar este comando?
 *
 * Ordem (a primeira que decide, decide):
 *   1. dono do servidor passa;
 *   2. quem tem Administrator passa;
 *   3. `admin_only` para todo o resto;
 *   4. `custom` usa só os cargos do comando;
 *   5. `inherit`/sem override usa os cargos do grupo;
 *   6. grupo sem cargos cai na permissão nativa antiga;
 *   7. nada permitiu: recusa.
 *
 * @param {any} interaction interação de comando ou de componente de painel.
 * @param {any} command módulo do comando, ou o nome dele (os painéis passam o
 *   nome do comando que os abre).
 * @returns {boolean}
 */
function canUseCommand(interaction, command) {
  const commandName = commandNameOf(command);

  // Todo comando controlado é `setDMPermission(false)`; fora de servidor não há
  // cargo nem dono para consultar.
  if (!interaction.guildId && !interaction.guild) return false;

  const memberId = interaction.member?.id ?? interaction.user?.id;
  if (memberId && interaction.guild?.ownerId === memberId) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  const group = COMMAND_GROUP[commandName];
  // Comando fora do catálogo (`/ping`, `/rank`, `/top`) não é controlado aqui.
  if (!group) return true;

  const config = getCommandPermissions(interaction.guildId ?? interaction.guild.id);
  const override = effectiveOverride(config, commandName);

  if (override?.mode === 'admin_only') return false;
  if (override?.mode === 'custom') return hasAnyRole(interaction.member, override.roleIds);

  const groupRoles = config.groups[group] ?? [];
  if (groupRoles.length) return hasAnyRole(interaction.member, groupRoles);

  return legacyAllows(interaction, commandName);
}

module.exports = {
  ADMIN_LOCKABLE,
  ADMIN_ONLY_DEFAULTS,
  COMMAND_GROUP,
  CONFIG_FIELD,
  GROUPS,
  GROUP_KEYS,
  LEGACY_PERMISSION,
  MAX_ROLES,
  MODES,
  PERMISSION_DENIED_MESSAGE,
  canUseCommand,
  clearCommandOverride,
  effectiveOverride,
  getCommandPermissions,
  normalizeCommandPermissions,
  saveCommandPermissions,
  setCommandOverride,
  setGroupRoles,
};
