// @ts-check
/**
 * Painel público de abertura de tickets.
 *
 * Monta a mensagem que o membro vê a partir de `ticket_config.panel`. Fica fora
 * do `ticketHandler` porque tem dois consumidores: o runtime (que redesenha o
 * painel) e o `/ticket-config`, que o usa como preview e o publica.
 *
 * O `customId` do botão continua sendo `ticket_open`: os painéis já publicados
 * antes desta refatoração seguem funcionando sem republicar.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../embeds');
const { emoji, isBrokenCustomEmoji } = require('../emojis');
const { resolveColor } = require('../colors');

const DEFAULT_TITLE_TEXT = 'Central de Atendimento';
const DEFAULT_DESCRIPTION =
  'Precisa de ajuda? Clique no botão abaixo para abrir um ticket e falar com a nossa equipe.';

/** Título do painel, com o padrão dependente do emoji do servidor. */
function resolvePanelTitle(guild, config) {
  return config.panel.title ?? `${emoji(guild, 'ticket')} ${DEFAULT_TITLE_TEXT}`;
}

/**
 * Emoji do botão pronto para `setEmoji()`.
 *
 * Sem valor próprio usa a chave `ticket` do /config-emojis. Um personalizado que
 * saiu do ar também cai no padrão: id inválido derruba o envio da mensagem
 * inteira, e o painel público é justamente onde isso apareceria como um botão
 * que nunca chega ao canal.
 */
function resolveButtonEmoji(guild, config) {
  const value = config.panel.buttonEmoji;
  if (!value || isBrokenCustomEmoji(guild, value)) return emoji(guild, 'ticket');
  return value;
}

/** Linha do botão de abrir ticket. */
function buildTicketPanelComponents(guild, config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel(config.panel.buttonLabel)
        .setEmoji(resolveButtonEmoji(guild, config))
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

/**
 * Payload completo do painel público.
 * @param {import('discord.js').Guild|null} guild
 * @param {import('./config').TicketConfig} config
 */
function buildTicketPanel(guild, config) {
  return {
    embeds: [
      baseEmbed({
        title: resolvePanelTitle(guild, config),
        description: config.panel.description ?? DEFAULT_DESCRIPTION,
        // `null` da paleta cai na cor padrão do baseEmbed.
        color: resolveColor(config.panel.color) ?? undefined,
      }),
    ],
    components: buildTicketPanelComponents(guild, config),
    allowedMentions: { parse: [] },
  };
}

module.exports = {
  DEFAULT_TITLE_TEXT,
  DEFAULT_DESCRIPTION,
  resolvePanelTitle,
  resolveButtonEmoji,
  buildTicketPanelComponents,
  buildTicketPanel,
};
