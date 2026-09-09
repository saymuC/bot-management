/**
 * Diagnóstico dos acks que falham (10062 e 40060).
 *
 * Nenhum dos dois é bug, e é por isso que os handlers seguem em frente:
 *   10062 "Unknown interaction"  — o token de 3s do clique venceu;
 *   40060 "Already acknowledged" — outra instância do bot já respondeu o clique.
 *
 * O aviso antigo (`não pôde ser ackada (10062)`) não dizia nada acionável, e um
 * erro opaco que aparece de vez em quando é pior que nenhum. A idade da interação
 * é o que separa os dois cenários possíveis, então ela vai no log:
 *
 *   idade > 3s  → o evento chegou tarde. O relógio dos 3s corre no Discord, não
 *                 aqui: o clique gastou o prazo na rede ou foi reentregue depois
 *                 de um resume da conexão do gateway. Não há nada a corrigir no
 *                 código — só cabe tratar, que é o que o safeAck faz.
 *   idade < 3s  → o clique chegou em tempo e o ack é que não saiu a tempo:
 *                 processo bloqueado ou latência de saída até a API.
 */

/** Janela que o Discord dá para o primeiro ack de uma interação. */
const ACK_WINDOW_MS = 3000;

const REASONS = Object.freeze({
  10062: 'token expirado',
  40060: 'clique já respondido',
});

/** @returns {boolean} true quando o erro é um ack perdido, não uma falha real. */
const isAckFailure = (err) => Object.hasOwn(REASONS, err?.code ?? -1);

/**
 * Uma linha de aviso com a idade da interação e a causa provável.
 * @param {string} scope prefixo do log (ex.: 'verify').
 */
function logAckFailure(scope, interaction, err) {
  const label = interaction.customId || interaction.commandName || 'interação';
  const age = Date.now() - interaction.createdTimestamp;

  // Em 40060 a idade não diagnostica nada: o clique foi respondido, só não por nós.
  const diagnosis =
    err.code === 40060
      ? 'outra instância do bot respondeu antes'
      : age > ACK_WINDOW_MS
        ? 'o evento chegou tarde (rede ou reentrega do gateway); nada a corrigir no bot'
        : 'chegou em tempo, mas o ack não saiu a tempo (processo travado ou saída lenta)';

  console.warn(`[${scope}] ${label}: ${REASONS[err.code]} após ${age}ms — ${diagnosis}. Ação ignorada.`);
}

/**
 * Fábrica do `safeAck` de cada painel: acka e devolve false quando o ack se
 * perdeu, para o fluxo parar em vez de seguir sem canal de resposta.
 *
 * Era o mesmo bloco try/catch copiado em cinco handlers, cada um com sua redação
 * do aviso — daí virar um só, com o escopo como parâmetro.
 *
 * @param {string} scope prefixo do log (ex.: 'verify').
 * @returns {(interaction: object, ack: () => Promise<unknown>) => Promise<boolean>}
 */
function makeSafeAck(scope) {
  return async function safeAck(interaction, ack) {
    try {
      await ack();
      return true;
    } catch (err) {
      if (isAckFailure(err)) {
        logAckFailure(scope, interaction, err);
        return false;
      }
      throw err;
    }
  };
}

/**
 * Catch para chamadas que não têm o que abortar depois — `showModal`, tipicamente:
 * sem modal na tela, não há fluxo a interromper, só o aviso a registrar.
 * @returns {(err: Error) => undefined}
 */
const swallowAckFailure = (scope, interaction) => (err) => {
  if (isAckFailure(err)) {
    logAckFailure(scope, interaction, err);
    return undefined;
  }
  throw err;
};

module.exports = { ACK_WINDOW_MS, isAckFailure, logAckFailure, makeSafeAck, swallowAckFailure };
