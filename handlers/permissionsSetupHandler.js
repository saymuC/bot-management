// @ts-check
/**
 * Painel de permissões de comandos (`/config` -> Permissões de comandos).
 *
 * Duas telas de entrada, porque são dois usos diferentes:
 *   - por grupo: o caminho rápido, um cargo por área do bot;
 *   - por comando: o ajuste fino em cima do grupo.
 *
 * Tudo salva no clique — não há botão "Salvar". Um painel de permissões com
 * rascunho é a chance de alguém sair da tela achando que salvou.
 *
 * As regras e o formato do JSON moram em utils/commandPermissions.js; aqui só
 * tem tela.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  ADMIN_LOCKABLE,
  ADMIN_ONLY_DEFAULTS,
  COMMAND_GROUP,
  GROUPS,
  GROUP_KEYS,
  MAX_ROLES,
  MODES,
  PERMISSION_DENIED_MESSAGE,
  canUseCommand,
  clearCommandOverride,
  effectiveOverride,
  getCommandPermissions,
  setCommandOverride,
  setGroupRoles,
} = require('../utils/commandPermissions');
const { baseEmbed, errorEmbed } = require('../utils/embeds');
const { emoji } = require('../utils/emojis');
const { makeSafeAck } = require('../utils/interactionAck');

const PREFIX = 'perms_';
const safeAck = makeSafeAck('command-permissions');

/** O painel vive dentro do `/config`, então o gate dele é o do `/config`. */
const OWNER_COMMAND = 'config';

/** @type {Record<import('../utils/commandPermissions').PermissionMode, string>} */
const MODE_LABELS = Object.freeze({
  inherit: 'Herdar do grupo',
  custom: 'Cargos específicos',
  admin_only: 'Somente Administrator',
});

const MODE_DESCRIPTIONS = Object.freeze({
  inherit: 'Usa os cargos configurados no grupo',
  custom: 'Usa apenas os cargos escolhidos aqui',
  admin_only: 'Nem cargo nenhum libera: só dono e Administrator',
});

const ADMIN_LOCKABLE_SET = new Set(ADMIN_LOCKABLE);

const mention = (roleId) => `<@&${roleId}>`;
const roleList = (roleIds) => (roleIds.length ? roleIds.map(mention).join(', ') : '*nenhum*');

/** Resumo curto de uma linha, para a descrição das opções do select. */
function summarize(config, commandName) {
  const override = effectiveOverride(config, commandName);
  if (override?.mode === 'admin_only') return MODE_LABELS.admin_only;
  if (override?.mode === 'custom') {
    return `${override.roleIds.length} cargo(s) próprio(s)`;
  }
  const groupRoles = config.groups[COMMAND_GROUP[commandName]] ?? [];
  return groupRoles.length ? `Herda o grupo (${groupRoles.length} cargo(s))` : 'Herda o grupo (sem cargos)';
}

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

/** Tela inicial: escolhe entre configurar por grupo ou por comando. */
function homePayload(guild) {
  const config = getCommandPermissions(guild.id);
  const lines = GROUP_KEYS.map(
    (group) => `${emoji(guild, GROUPS[group].emoji)} **${GROUPS[group].label}** — ${roleList(config.groups[group])}`
  );
  const overrides = Object.keys(config.commands).length;

  return {
    content: '',
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'config_permissions')} Permissões de comandos`,
        description:
          'Libere comandos do bot por cargo, sem precisar dar **Administrator** para a staff.\n\n' +
          `${lines.join('\n')}\n\n` +
          `Ajustes individuais ativos: **${overrides}**.\n` +
          'O dono do servidor e quem tem **Administrator** passam sempre.',
        footer: 'Grupo sem cargos mantém a permissão antiga do comando.',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}groups`)
          .setLabel('Configurar por grupo')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}commands`)
          .setLabel('Configurar comando individual')
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Lista de grupos, com a contagem de cargos de cada um. */
function groupListPayload(guild, notice) {
  const config = getCommandPermissions(guild.id);

  return {
    content: '',
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'config_permissions')} Permissões por grupo`,
        description: `${notice ? `${notice}\n\n` : ''}Escolha o grupo de comandos que você quer liberar por cargo.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}group-pick`)
          .setPlaceholder('Selecione um grupo')
          .addOptions(
            GROUP_KEYS.map((group) => ({
              label: GROUPS[group].label,
              value: group,
              emoji: emoji(guild, GROUPS[group].emoji),
              description: `${config.groups[group].length} cargo(s) — ${GROUPS[group].description}`.slice(0, 100),
            }))
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}home`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Tela de um grupo: seleção de cargos e limpeza. */
function groupPayload(guild, group, notice) {
  const config = getCommandPermissions(guild.id);
  const roleIds = config.groups[group];
  const commands = Object.keys(GROUPS[group].commands);

  return {
    content: '',
    embeds: [
      baseEmbed({
        title: `${emoji(guild, GROUPS[group].emoji)} Grupo ${GROUPS[group].label}`,
        description:
          `${notice ? `${notice}\n\n` : ''}Cargos autorizados: ${roleList(roleIds)}\n\n` +
          `**Comandos do grupo:** ${commands.map((name) => `\`/${name}\``).join(', ')}\n\n` +
          'A seleção substitui a lista atual e salva na hora. Comandos com ajuste ' +
          'individual não seguem este grupo.',
        footer: `Até ${MAX_ROLES} cargos por grupo.`,
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${PREFIX}group-roles:${group}`)
          .setPlaceholder('Cargos autorizados')
          .setMinValues(1)
          .setMaxValues(MAX_ROLES)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}group-clear:${group}`)
          .setLabel('Limpar cargos')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(roleIds.length === 0),
        new ButtonBuilder().setCustomId(`${PREFIX}groups`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Passo 1 do ajuste fino: de qual grupo é o comando. */
function commandGroupPayload(guild) {
  return {
    content: '',
    embeds: [
      baseEmbed({
        title: `${emoji(guild, 'config_permissions')} Permissão por comando`,
        description: 'Primeiro escolha o grupo do comando que você quer ajustar.',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}cmd-group`)
          .setPlaceholder('Selecione um grupo')
          .addOptions(
            GROUP_KEYS.map((group) => ({
              label: GROUPS[group].label,
              value: group,
              emoji: emoji(guild, GROUPS[group].emoji),
              description: GROUPS[group].description.slice(0, 100),
            }))
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}home`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/** Passo 2: qual comando do grupo. */
function commandListPayload(guild, group) {
  const config = getCommandPermissions(guild.id);
  const commands = Object.keys(GROUPS[group].commands);

  return {
    content: '',
    embeds: [
      baseEmbed({
        title: `${emoji(guild, GROUPS[group].emoji)} Comandos de ${GROUPS[group].label}`,
        description:
          `Cargos do grupo: ${roleList(config.groups[group])}\n\n` +
          'Escolha o comando para definir um ajuste próprio.',
      }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}cmd-pick:${group}`)
          .setPlaceholder('Selecione um comando')
          .addOptions(
            commands.map((name) => ({
              label: `/${name}`,
              value: name,
              description: summarize(config, name).slice(0, 100),
            }))
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}commands`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

/**
 * Passo 3: modo do comando (e os cargos, quando o modo é `custom`).
 *
 * `pendingMode` é o modo que o usuário acabou de escolher no select. Ele existe
 * porque `custom` sem cargo nenhum não fica salvo (viraria um comando trancado
 * para todos): sem isto, escolher "Cargos específicos" voltaria para a tela de
 * herança sem nunca mostrar o seletor de cargos.
 *
 * @param {any} guild
 * @param {string} commandName
 * @param {string} [notice] linha de feedback da última ação
 * @param {import('../utils/commandPermissions').PermissionMode} [pendingMode]
 */
function commandPayload(guild, commandName, notice, pendingMode) {
  const group = COMMAND_GROUP[commandName];
  const config = getCommandPermissions(guild.id);
  const override = effectiveOverride(config, commandName);
  const mode = pendingMode ?? override?.mode ?? 'inherit';

  const detail =
    mode === 'admin_only'
      ? 'Só o dono do servidor e quem tem **Administrator** podem usar.'
      : mode === 'custom'
        ? `Cargos do comando: ${roleList(override?.roleIds ?? [])}`
        : `Segue os cargos do grupo **${GROUPS[group].label}**: ${roleList(config.groups[group])}`;

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}cmd-mode:${commandName}`)
        .setPlaceholder('Modo de permissão')
        .addOptions(
          MODES.map((option) => ({
            label: MODE_LABELS[option],
            value: option,
            description: MODE_DESCRIPTIONS[option],
            default: option === mode,
          }))
        )
    ),
  ];

  // O seletor de cargos só aparece no modo que usa cargos — no `inherit` e no
  // `admin_only` ele não teria efeito nenhum, e um controle inerte no painel é
  // lido como bug.
  if (mode === 'custom') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${PREFIX}cmd-roles:${commandName}`)
          .setPlaceholder('Cargos deste comando')
          .setMinValues(1)
          .setMaxValues(MAX_ROLES)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}cmd-clear:${commandName}`)
        .setLabel('Limpar ajuste')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!config.commands[commandName]),
      new ButtonBuilder().setCustomId(`${PREFIX}cmd-list:${group}`).setLabel('Voltar').setStyle(ButtonStyle.Secondary)
    )
  );

  return {
    content: '',
    embeds: [
      baseEmbed({
        title: `${emoji(guild, GROUPS[group].emoji)} /${commandName}`,
        description:
          `${notice ? `${notice}\n\n` : ''}Modo atual: **${MODE_LABELS[mode]}**\n${detail}` +
          (ADMIN_LOCKABLE_SET.has(commandName)
            ? `\n\n${emoji(guild, 'warning')} Comando sensível: considere **${MODE_LABELS.admin_only}**.`
            : ''),
      }),
    ],
    components: rows,
    allowedMentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/**
 * Cargos escolhidos no select, sem o @everyone.
 *
 * O RoleSelectMenu do Discord oferece o @everyone, e autorizar @everyone é
 * liberar o comando para o servidor inteiro — o oposto do que este painel existe
 * para fazer. Então ele cai fora, com aviso.
 *
 * @returns {{ roleIds: string[], notice: string|undefined }}
 */
function pickedRoles(interaction) {
  const everyoneId = interaction.guild.roles.everyone?.id ?? interaction.guild.id;
  const selected = [...interaction.roles.values()];
  const roleIds = selected.filter((role) => role.id !== everyoneId).map((role) => role.id);

  return {
    roleIds,
    notice:
      roleIds.length === selected.length
        ? undefined
        : `${emoji(interaction.guild, 'warning')} @everyone foi ignorado: ele liberaria o comando para todo mundo.`,
  };
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

/** Roteia as interações do painel (`perms_*`). */
async function routePermissionsSetup(interaction) {
  if (!interaction.inGuild?.() && !interaction.guild) return undefined;

  if (!canUseCommand(interaction, OWNER_COMMAND)) {
    return safeAck(interaction, () =>
      interaction.reply({
        embeds: [errorEmbed(PERMISSION_DENIED_MESSAGE, undefined, interaction.guild)],
        flags: MessageFlags.Ephemeral,
      })
    );
  }

  const [action, arg] = interaction.customId.slice(PREFIX.length).split(':');
  const guild = interaction.guild;

  switch (action) {
    case 'home':
      return safeAck(interaction, () => interaction.update(homePayload(guild)));

    case 'groups':
      return safeAck(interaction, () => interaction.update(groupListPayload(guild)));

    case 'group-pick': {
      const group = interaction.values[0];
      if (!Object.hasOwn(GROUPS, group)) {
        return safeAck(interaction, () => interaction.update(groupListPayload(guild, 'Grupo desconhecido.')));
      }
      return safeAck(interaction, () => interaction.update(groupPayload(guild, group)));
    }

    case 'group-roles': {
      if (!Object.hasOwn(GROUPS, arg)) return undefined;
      const { roleIds, notice } = pickedRoles(interaction);
      setGroupRoles(guild.id, arg, roleIds);
      return safeAck(interaction, () => interaction.update(groupPayload(guild, arg, notice)));
    }

    case 'group-clear': {
      if (!Object.hasOwn(GROUPS, arg)) return undefined;
      setGroupRoles(guild.id, arg, []);
      return safeAck(interaction, () =>
        interaction.update(
          groupPayload(guild, arg, 'Cargos removidos: os comandos do grupo voltaram à permissão antiga do Discord.')
        )
      );
    }

    case 'commands':
      return safeAck(interaction, () => interaction.update(commandGroupPayload(guild)));

    case 'cmd-group': {
      const group = interaction.values[0];
      if (!Object.hasOwn(GROUPS, group)) {
        return safeAck(interaction, () => interaction.update(commandGroupPayload(guild)));
      }
      return safeAck(interaction, () => interaction.update(commandListPayload(guild, group)));
    }

    case 'cmd-list': {
      if (!Object.hasOwn(GROUPS, arg)) return undefined;
      return safeAck(interaction, () => interaction.update(commandListPayload(guild, arg)));
    }

    case 'cmd-pick': {
      const commandName = interaction.values[0];
      if (!Object.hasOwn(COMMAND_GROUP, commandName)) {
        return safeAck(interaction, () => interaction.update(commandGroupPayload(guild)));
      }
      return safeAck(interaction, () => interaction.update(commandPayload(guild, commandName)));
    }

    case 'cmd-mode': {
      if (!Object.hasOwn(COMMAND_GROUP, arg)) return undefined;
      const mode = interaction.values[0];
      if (!MODES.includes(mode)) return undefined;

      // Trocar para `custom` mantém os cargos que já havia; sem cargo nenhum, o
      // helper trata como herança até alguém escolher os cargos no select que
      // aparece na volta desta tela.
      const current = getCommandPermissions(guild.id).commands[arg];
      setCommandOverride(guild.id, arg, { mode, roleIds: mode === 'custom' ? (current?.roleIds ?? []) : [] });

      const notice =
        mode === 'custom' && !current?.roleIds?.length
          ? `${emoji(guild, 'warning')} Escolha os cargos abaixo — sem cargos, o comando continua herdando o grupo.`
          : undefined;
      return safeAck(interaction, () => interaction.update(commandPayload(guild, arg, notice, mode)));
    }

    case 'cmd-roles': {
      if (!Object.hasOwn(COMMAND_GROUP, arg)) return undefined;
      const { roleIds, notice } = pickedRoles(interaction);
      setCommandOverride(guild.id, arg, { mode: 'custom', roleIds });
      return safeAck(interaction, () => interaction.update(commandPayload(guild, arg, notice)));
    }

    case 'cmd-clear': {
      if (!Object.hasOwn(COMMAND_GROUP, arg)) return undefined;
      clearCommandOverride(guild.id, arg);
      // Os quatro comandos com padrão de fábrica `admin_only` voltam a ele, não
      // à herança — dizer "voltou a herdar" ali seria mentira na tela.
      const back = ADMIN_ONLY_DEFAULTS.has(arg)
        ? `Ajuste removido: o comando voltou ao padrão **${MODE_LABELS.admin_only}**.`
        : 'Ajuste removido: o comando voltou a herdar do grupo.';
      return safeAck(interaction, () => interaction.update(commandPayload(guild, arg, back)));
    }

    default:
      return undefined;
  }
}

module.exports = {
  PREFIX,
  MODE_LABELS,
  homePayload,
  groupListPayload,
  groupPayload,
  commandGroupPayload,
  commandListPayload,
  commandPayload,
  routePermissionsSetup,
};
