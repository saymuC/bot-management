/**
 * Detectores da família "excessos de formatação".
 *
 * São os mais baratos: olham só a mensagem atual, sem histórico e sem rede.
 * Por isso vêm primeiro na ordem de avaliação do motor.
 *
 * Cada detector devolve `{ detail }` quando houve violação (o texto que explica
 * o número encontrado contra o limite) ou `null` quando está tudo bem.
 */

const { PermissionFlagsBits } = require('discord.js');
const { capsRatio, zalgoRatio, countEmojis, countSpoilers } = require('../textNormalize');

/** Menções escritas no corpo da mensagem, de usuário e de cargo. */
function countWrittenMentions(content) {
  const users = content.match(/<@!?\d{17,20}>/g)?.length ?? 0;
  const roles = content.match(/<@&\d{17,20}>/g)?.length ?? 0;
  return users + roles;
}

/** Extensão de um nome de arquivo, sem ponto e em minúsculas. */
function extensionOf(name) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(String(name ?? '').trim());
  return match ? match[1].toLowerCase() : '';
}

const detectors = {
  /**
   * @everyone / @here.
   *
   * Checado pelo texto, não por `mentions.everyone`: quem não tem permissão de
   * mencionar todos escreve "@everyone" e o Discord não resolve a menção, então
   * `mentions.everyone` seria falso e a tentativa passaria batida. E é
   * justamente a tentativa que incomoda no chat. Quem tem a permissão de
   * verdade está isento — para o anúncio legítimo do staff não cair aqui.
   */
  everyone({ content, member }) {
    if (member?.permissions?.has(PermissionFlagsBits.MentionEveryone)) return null;
    if (!/@(everyone|here)\b/i.test(content)) return null;
    return { detail: 'tentou mencionar todos sem ter permissão' };
  },

  mentions({ content }, limits) {
    const count = countWrittenMentions(content);
    if (count <= limits.max) return null;
    return { detail: `${count} menções (limite: ${limits.max})` };
  },

  caps({ content }, limits) {
    if (content.length < limits.minLength) return null;
    const ratio = capsRatio(content);
    const percent = Math.round(ratio * 100);
    if (percent <= limits.percent) return null;
    return { detail: `${percent}% em caixa alta (limite: ${limits.percent}%)` };
  },

  emojis({ content }, limits) {
    const count = countEmojis(content);
    if (count <= limits.max) return null;
    return { detail: `${count} emojis (limite: ${limits.max})` };
  },

  lines({ content }, limits) {
    const count = content.split(/\r?\n/).length;
    if (count <= limits.max) return null;
    return { detail: `${count} linhas (limite: ${limits.max})` };
  },

  spoilers({ content }, limits) {
    const count = countSpoilers(content);
    if (count <= limits.max) return null;
    return { detail: `${count} spoilers (limite: ${limits.max})` };
  },

  zalgo({ content }, limits) {
    const percent = Math.round(zalgoRatio(content) * 100);
    if (percent <= limits.percent) return null;
    return { detail: `${percent}% de acentos combinantes (limite: ${limits.percent}%)` };
  },

  attachmentTypes({ attachmentNames }, limits) {
    if (!limits.extensions.length || !attachmentNames?.length) return null;

    // O admin pode ter escrito ".exe" ou "exe": os dois valem.
    const blocked = new Set(limits.extensions.map((ext) => ext.replace(/^\./, '')));
    const found = attachmentNames.map(extensionOf).filter((ext) => ext && blocked.has(ext));
    if (!found.length) return null;

    return { detail: `anexo bloqueado: .${[...new Set(found)].join(', .')}` };
  },
};

module.exports = { detectors, countWrittenMentions, extensionOf };
