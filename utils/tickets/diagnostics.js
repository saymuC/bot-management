// @ts-check
/**
 * Diagnóstico da configuração de tickets: o que está salvo mas não funciona.
 *
 * Um ticket que não abre é um erro que só aparece do lado do membro — o admin vê
 * a configuração salva e conclui que está tudo certo. Estas linhas são a
 * diferença entre "está tudo certo" e "está tudo salvo": cargo apagado,
 * categoria que não existe mais, bot sem permissão de criar canal, exigência de
 * claim num servidor sem equipe.
 *
 * Fica fora do handler porque é lógica pura sobre `guild` + config + categorias,
 * e é justamente a parte que vale testar sem Discord na frente.
 */

const { PermissionFlagsBits } = require('discord.js');
const { canPostEmbed } = require('../channelPerms');
const { resolveTicketLogChannelId } = require('./config');
const { ticketStaffRoleIds } = require('./permissions');

/** Nomes dos cargos que não existem mais, para citar o id no aviso. */
const missingRoles = (guild, roleIds) => roleIds.filter((id) => !guild.roles.cache.get(id));

/**
 * @param {import('discord.js').Guild} guild
 * @param {ReturnType<import('./config').normalizeTicketConfig>} config
 * @param {{ label: string, target_category_id: string|null, support_role_id: string|null }[]} categories
 * @returns {string[]}
 */
function ticketConfigWarnings(guild, config, categories) {
  const warnings = [];

  if (!config.enabled) warnings.push('o sistema está **desativado**: o botão do painel recusa novos tickets.');
  if (!categories.length) warnings.push('nenhuma categoria cadastrada: o botão do painel não tem o que oferecer.');

  // Sem isto o fluxo inteiro para no primeiro clique: criar o canal do ticket e
  // apagá-lo no encerramento dependem da mesma permissão.
  if (!guild.members.me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    warnings.push('não tenho a permissão **Gerenciar Canais**: não consigo criar nem apagar canais de ticket.');
  }

  if (!config.panel.channelId) {
    warnings.push('o painel público ainda não foi publicado — ninguém consegue abrir ticket.');
  } else {
    const channel = guild.channels.cache.get(config.panel.channelId);
    if (!channel) warnings.push('o canal do painel público não existe mais.');
    else if (!canPostEmbed(channel, guild)) warnings.push(`sem permissão em ${channel} para publicar o painel.`);
    else if (!config.panel.messageId) warnings.push('o canal do painel está definido, mas a mensagem nunca foi publicada.');
  }

  if (config.defaultParentCategoryId && !guild.channels.cache.get(config.defaultParentCategoryId)) {
    warnings.push('a categoria padrão do servidor não existe mais: os canais serão criados fora de categoria.');
  }

  // O fallback (canal geral de logs) mora no banco; o valor da própria config
  // vem antes para o diagnóstico refletir o que está na tela.
  const logChannelId = config.logChannelId ?? resolveTicketLogChannelId(guild.id);
  const logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
  if (!logChannelId) {
    warnings.push('sem canal de logs: transcripts, avaliações e fechamentos não serão registrados em lugar nenhum.');
  } else if (!logChannel) {
    warnings.push('o canal de logs não existe mais: transcripts e avaliações não serão registrados.');
  } else if (!canPostEmbed(logChannel, guild)) {
    warnings.push(`sem permissão em ${logChannel} para registrar logs e anexar transcripts.`);
  }

  const brokenParents = categories.filter((c) => c.target_category_id && !guild.channels.cache.get(c.target_category_id));
  if (brokenParents.length) {
    warnings.push(`categoria do Discord apagada em: ${brokenParents.map((c) => `**${c.label}**`).join(', ')}.`);
  }

  const brokenRoles = categories.filter((c) => c.support_role_id && !guild.roles.cache.get(c.support_role_id));
  if (brokenRoles.length) {
    warnings.push(`cargo de suporte apagado em: ${brokenRoles.map((c) => `**${c.label}**`).join(', ')}.`);
  }

  const goneStaff = missingRoles(guild, config.permissions.staffRoleIds);
  if (goneStaff.length) {
    warnings.push(`cargo de atendimento apagado (${goneStaff.length}): ninguém com ele consegue mais atender.`);
  }

  const goneManagers = missingRoles(guild, config.permissions.managerRoleIds);
  if (goneManagers.length) {
    warnings.push(`cargo de gerência apagado (${goneManagers.length}): só administradores encerram tickets.`);
  }

  // Exigir claim sem ninguém habilitado a reivindicar tranca o ticket aberto:
  // ninguém além de um administrador consegue encerrá-lo.
  if (config.permissions.requireClaimBeforeFinalClose && !ticketStaffRoleIds(guild.id, config).length) {
    warnings.push(
      'a exigência de reivindicar antes de encerrar está ligada, mas nenhum cargo de atendimento foi definido: ' +
        'só administradores conseguirão atender e encerrar.'
    );
  }

  return warnings;
}

module.exports = { ticketConfigWarnings };
