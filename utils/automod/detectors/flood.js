/**
 * Detectores da família "flood e spam".
 *
 * São os únicos que dependem de histórico, por isso vêm por último na ordem de
 * avaliação: consultar o tracker é mais caro que olhar a mensagem atual.
 *
 * O motor registra a mensagem no tracker **antes** de avaliar, então a mensagem
 * que está sendo julgada já conta. É o que faz o limite ser lido do jeito óbvio:
 * "5 mensagens em 5 segundos" viola na quinta, não na sexta.
 */

const { messageHistory } = require('../tracker');

/** Janela da regra em milissegundos. */
const windowOf = (limits) => limits.windowSeconds * 1000;

const detectors = {
  flood({ guild, member, now }, limits) {
    const history = messageHistory(guild.id, member.id, windowOf(limits), now);
    if (history.length < limits.messages) return null;

    return { detail: `${history.length} mensagens em ${limits.windowSeconds}s (limite: ${limits.messages})` };
  },

  duplicate({ guild, member, signature, now }, limits) {
    // Mensagem vazia (só anexo) não é "repetida": senão duas fotos seguidas
    // sem legenda contariam como o mesmo texto.
    if (!signature) return null;

    const repeats = messageHistory(guild.id, member.id, windowOf(limits), now)
      .filter((event) => event.signature === signature).length;

    if (repeats < limits.repeats) return null;
    return { detail: `mesma mensagem ${repeats}x em ${limits.windowSeconds}s (limite: ${limits.repeats})` };
  },

  crosspost({ guild, member, signature, now }, limits) {
    if (!signature) return null;

    const channels = new Set(
      messageHistory(guild.id, member.id, windowOf(limits), now)
        .filter((event) => event.signature === signature)
        .map((event) => event.channelId)
    );

    if (channels.size < limits.channels) return null;
    return { detail: `mesma mensagem em ${channels.size} canais (limite: ${limits.channels})` };
  },

  attachmentSpam({ guild, member, now }, limits) {
    const total = messageHistory(guild.id, member.id, windowOf(limits), now)
      .reduce((sum, event) => sum + event.attachments, 0);

    if (total < limits.attachments) return null;
    return { detail: `${total} anexos em ${limits.windowSeconds}s (limite: ${limits.attachments})` };
  },
};

module.exports = { detectors };
