const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { baseEmbed, errorEmbed } = require('../../utils/embeds');
const { xpProgress, MAX_LEVEL } = require('../../utils/levels/formula');
const { progressBar, formatXp } = require('../../utils/levels/leaderboard');
const { getXp, rankOf, participantCount } = require('../../utils/levels/repository');
const { getLevelsConfig } = require('../../utils/levels/config');

module.exports = {
  ephemeral: false,
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o nível, o XP e a posição no servidor')
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('usuario').setDescription('De quem ver o progresso (padrão: você)')),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario') ?? interaction.user;

    if (user.bot) {
      return respond(interaction, {
        embeds: [errorEmbed('Bots não acumulam XP, então não têm progresso para mostrar.')],
      });
    }

    // Só leitura: consultar alguém nunca cria registro. Quem nunca falou aparece
    // com 0 XP e fora do ranking, em vez de entrar nele por ter sido consultado.
    const totalXp = getXp(interaction.guild.id, user.id);
    const progress = xpProgress(totalXp);
    const config = getLevelsConfig(interaction.guild.id);

    const total = participantCount(interaction.guild.id);
    const position = totalXp > 0 ? rankOf(interaction.guild.id, user.id, totalXp) : null;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    const nextLine =
      progress.level >= MAX_LEVEL
        ? `Nível máximo (**${MAX_LEVEL}**) alcançado.`
        : `Faltam **${formatXp(progress.xpForNextLevel - progress.xpIntoLevel)} XP** para o nível **${progress.level + 1}**.`;

    return respond(interaction, {
      embeds: [
        baseEmbed({
          title: `📈 Progresso de ${member?.displayName ?? user.username}`,
          description: [
            `${progressBar(progress.percent)} **${Math.round(progress.percent * 100)}%**`,
            '',
            nextLine,
            config.enabled ? '' : '\n⚠️ O sistema de níveis está desligado neste servidor.',
          ]
            .filter(Boolean)
            .join('\n'),
          thumbnail: user.displayAvatarURL({ size: 256 }),
          fields: [
            { name: 'Nível', value: `**${progress.level}**`, inline: true },
            {
              name: 'XP no nível',
              value: progress.xpForNextLevel
                ? `${formatXp(progress.xpIntoLevel)} / ${formatXp(progress.xpForNextLevel)}`
                : formatXp(progress.xpIntoLevel),
              inline: true,
            },
            { name: 'XP total', value: formatXp(progress.totalXp), inline: true },
            {
              name: 'Posição',
              value: position ? `#${position} de ${formatXp(total)}` : 'ainda sem pontuação',
              inline: true,
            },
          ],
        }),
      ],
    });
  },
};
