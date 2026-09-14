const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../../utils/interactions');
const { successEmbed, errorEmbed, infoEmbed } = require('../../utils/embeds');
const { revokeAuthorization, isOAuthEnabled } = require('../../oauth/server');

/**
 * Saída da verificação por OAuth.
 *
 * A autorização é do usuário, então quem revoga é ele — sem opção de mexer na
 * conta de outra pessoa. O token é invalidado no Discord antes de a cópia local
 * ser apagada: apagar só o nosso registro deixaria o token vivo até vencer.
 */
module.exports = {
  ephemeral: true,
  data: new SlashCommandBuilder()
    .setName('desconectar-conta')
    .setDescription('Revoga a autorização que você deu ao bot pela verificação')
    .setDMPermission(false)
    .addBooleanOption((opt) =>
      opt
        .setName('todos-servidores')
        .setDescription('Revogar também nos outros servidores onde você autorizou este bot')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!isOAuthEnabled()) {
      return respond(interaction, {
        embeds: [errorEmbed('OAuth não está configurado neste bot, então não há autorização para revogar.')],
      });
    }

    const everywhere = interaction.options.getBoolean('todos-servidores') ?? false;
    const { revoked } = await revokeAuthorization(interaction.user.id, everywhere ? null : interaction.guild.id);

    if (revoked === 0) {
      return respond(interaction, {
        embeds: [
          infoEmbed(
            everywhere
              ? 'Você não tem nenhuma autorização ativa neste bot.'
              : 'Você não tem autorização ativa **neste servidor**. Use `todos-servidores: true` para conferir os outros.'
          ),
        ],
      });
    }

    return respond(interaction, {
      embeds: [
        successEmbed(
          `Autorização revogada em ${revoked} servidor(es). O bot não consegue mais usar sua conta.\n` +
            'Se quiser voltar, basta usar o painel de verificação de novo.',
          '🔌 Conta desconectada'
        ),
      ],
    });
  },
};
