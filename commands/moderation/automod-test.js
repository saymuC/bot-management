/**
 * Testa uma frase contra as regras ligadas sem punir ninguém.
 *
 * Existe porque a alternativa é o admin virar cobaia do próprio filtro: ligar
 * "palavras proibidas", escrever a palavra num canal público e ver o que acontece.
 */

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed } = require('../../utils/embeds');
const { colors } = require('../../config/settings');
const { formatDuration } = require('../../utils/time');
const { RULES, ACTIONS, NOTIFY_MODES } = require('../../config/automodRules');
const { getAutomodConfig, exemptionReason } = require('../../utils/automod/config');
const { dryRun } = require('../../handlers/automodHandler');

module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('automod-test')
    .setDescription('Testa um texto contra as regras do AutoMod sem punir ninguém')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt.setName('texto').setDescription('O texto a testar').setRequired(true).setMaxLength(2000)
    )
    .addChannelOption((opt) =>
      opt.setName('canal').setDescription('Simular como se fosse enviado neste canal (padrão: o atual)')
    )
    .addUserOption((opt) => opt.setName('como').setDescription('Simular como este membro (padrão: você)')),

  async execute(interaction) {
    const content = interaction.options.getString('texto', true);
    const channel = interaction.options.getChannel('canal') ?? interaction.channel;
    const target = interaction.options.getUser('como') ?? interaction.user;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return respond(interaction, {
        embeds: [baseEmbed({ title: '⚠️ Membro não encontrado', description: `${target} não está no servidor.`, color: colors.warning })],
      });
    }

    const config = getAutomodConfig(interaction.guild.id);
    // A lista, não a contagem: "2 filtros ligados" não ajuda quem esperava que o
    // filtro de palavras estivesse entre eles.
    const enabled = Object.keys(config.rules).filter((key) => config.rules[key].enabled);

    // A isenção é a explicação mais comum para "o AutoMod não pegou": vale dizer
    // antes de mostrar que nada foi encontrado.
    const exempt = exemptionReason(config, { exemptRoleIds: [], exemptChannelIds: [] }, member, channel.id);

    const violation = await dryRun({ guild: interaction.guild, member, channelId: channel.id, content });

    const fields = [
      { name: 'AutoMod', value: config.enabled ? '🟢 ativado' : '🔴 **desativado** (nada seria filtrado)', inline: true },
      { name: 'Simulado como', value: `${member} em ${channel}`, inline: true },
      {
        name: `Filtros ligados (${enabled.length} de ${Object.keys(config.rules).length})`,
        value: enabled.length
          ? enabled.map((key) => `${RULES[key].emoji} ${RULES[key].label}`).join(' · ')
          : '**nenhum** — ligue os filtros no `/automod`, senão não há o que testar.',
        inline: false,
      },
    ];

    if (exempt) fields.push({ name: '🪪 Isenção global', value: `Este membro/canal está livre: **${exempt}**.`, inline: false });

    if (violation) {
      const rule = config.rules[violation.key];
      fields.push(
        { name: 'Regra acionada', value: `${RULES[violation.key].emoji} **${violation.label}**`, inline: false },
        { name: 'Motivo', value: violation.detail, inline: false },
        {
          name: 'O que aconteceria',
          value: [
            rule.deleteMessage ? '🗑️ mensagem apagada' : 'mensagem mantida',
            `${ACTIONS[rule.action].emoji} ${ACTIONS[rule.action].label}`,
            `🎯 +${rule.points} ponto(s)`,
            `${NOTIFY_MODES[rule.notify].emoji} ${NOTIFY_MODES[rule.notify].label}`,
            // Só o aviso no canal tem prazo; a DM é do usuário e o bot não a apaga.
            rule.notify === 'channel'
              ? rule.noticeTtlMs > 0
                ? `⏱️ o aviso se apaga em ${formatDuration(rule.noticeTtlMs)}`
                : '📌 o aviso fica no canal'
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
          inline: false,
        }
      );
    }

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: violation ? '🚫 O texto seria bloqueado' : '✅ O texto passaria',
          description: [
            `\`\`\`${content.slice(0, 900)}\`\`\``,
            violation
              ? 'O motor para na primeira regra violada, então pode haver outras além desta.'
              : 'Flood e repetição dependem do histórico real; anexo, figurinha e arquivo não ' +
                'existem num teste de texto. Nada disso é simulado aqui.',
          ].join('\n'),
          color: violation ? colors.error : colors.success,
          fields,
        }),
      ],
    });
  },
};
