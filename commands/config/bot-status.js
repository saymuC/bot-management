const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { isHttpUrl } = require('../../utils/media');
const {
  STATUSES,
  ACTIVITIES,
  DEFAULT_PRESENCE,
  getSavedPresence,
  savePresence,
  applyPresence,
  describePresence,
} = require('../../utils/presence');

const statusChoices = Object.entries(STATUSES).map(([value, meta]) => ({ name: meta.label, value }));
const activityChoices = Object.entries(ACTIVITIES).map(([value, meta]) => ({ name: meta.label, value }));

/**
 * A presença é global (vale para todos os servidores), então quando OWNER_ID
 * está definido só o dono muda — um admin de um servidor qualquer não deveria
 * alterar como o bot aparece nos outros.
 */
function isAllowed(interaction) {
  const ownerId = process.env.OWNER_ID?.trim();
  if (ownerId) return interaction.user.id === ownerId;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('bot-status')
    .setDescription('Altera o status e a atividade do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((option) =>
      option.setName('presenca').setDescription('Disponibilidade exibida no perfil').addChoices(...statusChoices)
    )
    .addStringOption((option) =>
      option.setName('atividade').setDescription('Tipo de atividade (Jogando, Assistindo...)').addChoices(...activityChoices)
    )
    .addStringOption((option) =>
      option.setName('texto').setDescription('Mensagem da atividade (máx. 128 caracteres)').setMaxLength(128)
    )
    .addStringOption((option) => option.setName('url').setDescription('URL da live (só para Transmitindo)'))
    .addBooleanOption((option) => option.setName('padrao').setDescription('Restaura o status padrão do bot')),

  async execute(interaction) {
    if (!isAllowed(interaction)) {
      return respond(interaction, {
        embeds: [errorEmbed('Você não tem permissão para alterar o status do bot.')],
      });
    }

    const current = getSavedPresence();
    const restoreDefault = interaction.options.getBoolean('padrao') ?? false;
    const status = interaction.options.getString('presenca');
    const activity = interaction.options.getString('atividade');
    const text = interaction.options.getString('texto');
    const url = interaction.options.getString('url');

    // Sem nenhuma opção: só mostra o que está valendo agora.
    if (!restoreDefault && !status && !activity && text === null && !url) {
      return respond(interaction, {
        embeds: [
          infoEmbed(
            `**Status atual:** ${describePresence(current)}\n\n` +
              'Use as opções do comando para alterar (`presenca`, `atividade`, `texto`, `url`) ou `padrao: true` para restaurar.'
          ),
        ],
      });
    }

    if (url && !isHttpUrl(url)) {
      return respond(interaction, { embeds: [errorEmbed('A `url` precisa começar com `http://` ou `https://`.')] });
    }

    const next = restoreDefault
      ? { ...DEFAULT_PRESENCE }
      : {
          ...current,
          ...(status ? { status } : {}),
          ...(activity ? { activity } : {}),
          ...(text === null ? {} : { text }),
          ...(url ? { url } : {}),
        };

    const warnings = [];
    if (next.activity === 'streaming' && !next.url) {
      warnings.push('`Transmitindo` sem `url` aparece como texto simples — informe a URL da live.');
    }
    if (next.activity !== 'none' && !next.text) {
      warnings.push('Sem `texto` o bot fica sem atividade nenhuma.');
    }

    try {
      const applied = applyPresence(interaction.client, next);
      savePresence(applied);

      const suffix = warnings.length ? `\n\n⚠️ ${warnings.join('\n⚠️ ')}` : '';
      return respond(interaction, {
        embeds: [successEmbed(`Status atualizado para: ${describePresence(applied)}${suffix}`)],
      });
    } catch (err) {
      console.error('[bot-status] Falha ao aplicar presença:', err.message);
      return respond(interaction, { embeds: [errorEmbed('Não consegui aplicar esse status. Tente novamente.')] });
    }
  },
};
