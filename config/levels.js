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
  /** Título grande do cabeçalho. Curto porque sai em 54px numa largura de 1000. */
  titleChars: 28,
  /** Opacidade do véu sobre o fundo, em porcentagem. */
  veil: Object.freeze({ min: 0, max: 90 }),
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
 * Presets de tema da imagem do ranking.
 *
 * Cada preset declara só as **superfícies**: o papel dos cartões (`card`), o papel
 * do primeiro lugar (`hero`), o texto que fica sobre o fundo (`page`), a cor de
 * base do fundo e as três paradas do degradê gerado.
 *
 * A cor da **tinta** não aparece aqui de propósito: ela é derivada da luminância
 * do papel em `utils/levels/card/visual.js`. Se o admin trocasse o papel para um
 * tom escuro e a tinta continuasse escura, o número que ele abriu o `/top` para
 * ler desapareceria — e é justamente a legibilidade que motivou este layout.
 */
const THEME_PRESETS = Object.freeze({
  paper: Object.freeze({
    label: 'Papel',
    emoji: '📜',
    description: 'O padrão: papel bege sobre fundo grafite',
    card: '#e8e6de',
    hero: '#faf8f2',
    page: '#f4f3ef',
    base: '#0d0e11',
    gradient: Object.freeze(['#191b21', '#12131a', '#0d0e11']),
  }),
  noir: Object.freeze({
    label: 'Noir',
    emoji: '🌑',
    description: 'Cartões escuros com texto claro',
    card: '#1c1d22',
    hero: '#26272e',
    page: '#f4f3ef',
    base: '#07070a',
    gradient: Object.freeze(['#15161b', '#0d0e12', '#07070a']),
  }),
  sakura: Object.freeze({
    label: 'Sakura',
    emoji: '🌸',
    description: 'Papel rosado sobre fundo vinho',
    card: '#f6e4e6',
    hero: '#fdf3f4',
    page: '#f7eef0',
    base: '#1a1013',
    gradient: Object.freeze(['#2a1a20', '#1f1318', '#1a1013']),
  }),
  menta: Object.freeze({
    label: 'Menta',
    emoji: '🌿',
    description: 'Papel esverdeado sobre fundo mata',
    card: '#e2efe8',
    hero: '#f3faf6',
    page: '#eef7f3',
    base: '#0b1512',
    gradient: Object.freeze(['#132420', '#0e1a17', '#0b1512']),
  }),
  ambar: Object.freeze({
    label: 'Âmbar',
    emoji: '🔥',
    description: 'Papel de pergaminho sobre fundo tostado',
    card: '#f3e7d3',
    hero: '#fdf6ea',
    page: '#f8f1e4',
    base: '#171208',
    gradient: Object.freeze(['#2a1f0f', '#1e160a', '#171208']),
  }),
  ardosia: Object.freeze({
    label: 'Ardósia',
    emoji: '🪨',
    description: 'Papel cinza-azulado sobre fundo noite',
    card: '#dfe3ea',
    hero: '#f0f3f8',
    page: '#eef1f6',
    base: '#0b0f16',
    gradient: Object.freeze(['#141a25', '#0f141d', '#0b0f16']),
  }),
});

/**
 * Cores de destaque.
 *
 * Pintam a barra de progresso, a placa do avatar no `/rank` e a faixa lateral dos
 * cartões. O `to` acompanha o `hex` em vez de ser calculado: um clareamento
 * automático acerta em algumas cores e suja outras, e escolher os dois tons à mão
 * custa uma linha.
 */
const ACCENT_COLORS = Object.freeze({
  grafite: Object.freeze({ label: 'Grafite', emoji: '⬛', hex: '#2a2c34', to: '#6f7683' }),
  dourado: Object.freeze({ label: 'Dourado', emoji: '🟨', hex: '#a97c1c', to: '#e0b95a' }),
  azul: Object.freeze({ label: 'Azul', emoji: '🟦', hex: '#1f4f8c', to: '#5b8fd6' }),
  ciano: Object.freeze({ label: 'Ciano', emoji: '🩵', hex: '#146e78', to: '#4fb3bf' }),
  verde: Object.freeze({ label: 'Verde', emoji: '🟩', hex: '#226b3a', to: '#5fae74' }),
  roxo: Object.freeze({ label: 'Roxo', emoji: '🟪', hex: '#4a2c7a', to: '#8f6bc8' }),
  rosa: Object.freeze({ label: 'Rosa', emoji: '🩷', hex: '#8c2a58', to: '#d372a0' }),
  vermelho: Object.freeze({ label: 'Vermelho', emoji: '🟥', hex: '#8f2020', to: '#d16a5c' }),
  laranja: Object.freeze({ label: 'Laranja', emoji: '🟧', hex: '#a5501a', to: '#e4934f' }),
  terra: Object.freeze({ label: 'Terra', emoji: '🟫', hex: '#6b4a2f', to: '#ab8560' }),
  prata: Object.freeze({ label: 'Prata', emoji: '⬜', hex: '#5c6470', to: '#a7b0bd' }),
});

/** Cantos dos cartões. */
const CORNER_STYLES = Object.freeze({
  rounded: Object.freeze({ label: 'Arredondados', emoji: '🔵' }),
  square: Object.freeze({ label: 'Retos', emoji: '🟦' }),
});

/**
 * Aparência inicial: exatamente o visual que o bot já desenhava.
 *
 * Um servidor que nunca abriu a tela de aparência tem de continuar com o ranking
 * idêntico ao de antes desta funcionalidade existir.
 */
const DEFAULT_THEME = Object.freeze({
  preset: 'paper',
  accent: 'grafite',
  /** Sobrescreve o papel do preset, em `#RRGGBB`. `null` = usa o preset. */
  cardColor: null,
  /** Sobrescreve a cor de destaque, em `#RRGGBB`. `null` = usa o catálogo. */
  accentColor: null,
  veil: 50,
  corners: 'rounded',
  /** Título do cabeçalho. `null` = "Ranking de XP". */
  title: null,
  showAvatars: true,
  showBars: true,
  showTexture: true,
  showShadow: true,
  showMedals: true,
  showFooter: true,
});

/** Os liga/desliga do tema, para o painel montar o multi-select sem repetir a lista. */
const THEME_TOGGLES = Object.freeze([
  Object.freeze({ key: 'showAvatars', label: 'Avatares', emoji: '🖼️', description: 'Foto de cada membro na linha' }),
  Object.freeze({ key: 'showBars', label: 'Barras de progresso', emoji: '📊', description: 'Quanto falta para o próximo nível' }),
  Object.freeze({ key: 'showTexture', label: 'Textura', emoji: '🧵', description: 'Hachura discreta dentro dos cartões' }),
  Object.freeze({ key: 'showShadow', label: 'Sombra', emoji: '🌓', description: 'Cartões destacados do fundo' }),
  Object.freeze({ key: 'showMedals', label: 'Medalhas', emoji: '🥇', description: 'Ouro, prata e bronze no pódio' }),
  Object.freeze({ key: 'showFooter', label: 'Rodapé', emoji: '🔻', description: 'Total de participantes no pé da imagem' }),
]);

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
  theme: DEFAULT_THEME,
});

module.exports = {
  MAX_LEVEL,
  LIMITS,
  MAX_BACKGROUND_BYTES,
  REWARD_MODES,
  THEME_PRESETS,
  ACCENT_COLORS,
  CORNER_STYLES,
  THEME_TOGGLES,
  DEFAULT_THEME,
  DEFAULT_CONFIG,
};
