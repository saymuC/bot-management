// @ts-check
/**
 * Defaults e limites estáticos do módulo de Levels/XP.
 *
 * Igual ao `config/automodRules.js`: o catálogo fica fora do normalizador, para
 * o painel, os testes e a config lerem o mesmo lugar. Nada aqui depende do
 * Discord nem do banco.
 */

/** Teto do nível. Existe para a busca binária ter um fim e para o XP ter teto. */
const MAX_LEVEL = 1000;

/**
 * Faixas aceitas pelo normalizador. Tudo que chega fora da faixa é grudado no
 * limite mais próximo; tudo que não é número volta ao default.
 */
const LIMITS = Object.freeze({
  xp: Object.freeze({ min: 1, max: 10_000 }),
  cooldownSeconds: Object.freeze({ min: 10, max: 3600 }),
  minUsefulChars: Object.freeze({ min: 1, max: 100 }),
  repeatWindowSeconds: Object.freeze({ min: 0, max: 3600 }),
  /** Tetos de lista: a config vive num JSON numa coluna, não numa tabela. */
  ignoredChannels: 50,
  ignoredRoles: 50,
  rewards: 50,
  rolesPerReward: 10,
  /** Frase do topo da imagem do ranking. Mais que isto não cabe na largura. */
  headlineChars: 80,
});

/**
 * Teto do arquivo de fundo do ranking.
 *
 * Bem maior que o do emoji (256 KB) porque é uma ilustração de 1000 px de
 * largura, e bem menor que o limite de anexo do Discord porque o bot **decodifica**
 * a imagem: um PNG de 20 MB viraria centenas de MB de bitmap na memória.
 */
const MAX_BACKGROUND_BYTES = 4 * 1024 * 1024;

/** Como os cargos de recompensa se comportam quando o membro sobe de nível. */
const REWARD_MODES = Object.freeze({
  stack: Object.freeze({
    label: 'Acumulativo',
    emoji: '📚',
    description: 'Mantém os cargos de todos os níveis já alcançados',
  }),
  highest: Object.freeze({
    label: 'Somente o maior',
    emoji: '🏅',
    description: 'Mantém só os cargos do maior nível alcançado',
  }),
});

/**
 * Config inicial de um servidor.
 *
 * `enabled: false` é deliberado: instalar uma versão nova do bot não pode ligar
 * um sistema que distribui cargos sem um admin ter pedido.
 */
const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  xpMin: 15,
  xpMax: 25,
  cooldownSeconds: 60,
  minUsefulChars: 5,
  repeatWindowSeconds: 300,
  ignoredChannelIds: Object.freeze([]),
  ignoredRoleIds: Object.freeze([]),
  announceEnabled: true,
  announceChannelId: null,
  rewardMode: 'stack',
  rewards: Object.freeze([]),
  /** Aparência da imagem do `/top` e do `/rank`. `null` = fundo desenhado pelo bot. */
  backgroundUrl: null,
  headline: null,
});

module.exports = { MAX_LEVEL, LIMITS, MAX_BACKGROUND_BYTES, REWARD_MODES, DEFAULT_CONFIG };
