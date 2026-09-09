/**
 * Catálogo das regras do AutoMod.
 *
 * É declarativo de propósito: o painel do /automod monta os selects e os modais
 * a partir daqui, e os detectores leem os mesmos campos. Adicionar uma regra é
 * escrever uma entrada nesta tabela e um `check` no detector da família — nada
 * de mexer na interface.
 *
 * `fields` descreve os limites configuráveis de cada regra. O painel os
 * transforma em campos de modal, então **no máximo 5 por regra** (limite do
 * Discord). Tipos aceitos:
 *   int     — número inteiro entre min e max
 *   percent — inteiro de 0 a 100
 *   bool    — o usuário escreve sim/não
 *   list    — uma entrada por linha (palavras, domínios, extensões)
 */

/** Famílias, na ordem em que aparecem no painel. */
const FAMILIES = Object.freeze({
  spam: { label: 'Flood e spam', emoji: '💨' },
  links: { label: 'Links e convites', emoji: '🔗' },
  words: { label: 'Palavras proibidas', emoji: '🤬' },
  excess: { label: 'Excessos de formatação', emoji: '🔠' },
  raid: { label: 'Proteção contra raid', emoji: '🛡️' },
});

/** Ações imediatas que uma regra pode disparar. */
const ACTIONS = Object.freeze({
  none: { label: 'Nenhuma', emoji: '➖', description: 'Só o que a regra já faz (apagar/avisar)' },
  warn: { label: 'Advertir', emoji: '⚠️', description: 'Registra um warn, igual ao /warn' },
  mute: { label: 'Silenciar', emoji: '🔇', description: 'Timeout do Discord pela duração configurada' },
  kick: { label: 'Expulsar', emoji: '👢', description: 'Remove do servidor; pode voltar' },
  ban: { label: 'Banir', emoji: '🔨', description: 'Remove e impede de voltar' },
});

/** Para onde vai o aviso ao infrator. */
const NOTIFY_MODES = Object.freeze({
  none: { label: 'Não avisar', emoji: '🤫' },
  channel: { label: 'No canal (apaga sozinho)', emoji: '💬' },
  dm: { label: 'Na DM', emoji: '📩' },
});

/** Duração padrão do mute quando a regra ou a escada pede silenciamento. */
const DEFAULT_MUTE_MS = 10 * 60 * 1000;

/** Base comum a toda regra; cada uma sobrescreve o que precisa. */
const BASE_DEFAULTS = Object.freeze({
  enabled: false,
  deleteMessage: true,
  action: 'none',
  muteMs: DEFAULT_MUTE_MS,
  points: 1,
  notify: 'channel',
  exemptRoleIds: [],
  exemptChannelIds: [],
});

const int = (label, def, min, max, hint) => ({ type: 'int', label, default: def, min, max, hint });
const percent = (label, def, hint) => ({ type: 'percent', label, default: def, min: 1, max: 100, hint });
const bool = (label, def, hint) => ({ type: 'bool', label, default: def, hint });
const list = (label, hint) => ({ type: 'list', label, default: [], hint });

/**
 * As 18 regras. A ordem aqui é a ordem de avaliação no motor: o mais barato de
 * checar vem antes, e o motor para na primeira violação.
 */
const RULES = Object.freeze({
  // ---- Excessos: só olham a mensagem atual, sem histórico. Os mais baratos. ----
  everyone: {
    family: 'excess',
    label: '@everyone e @here',
    emoji: '📣',
    description: 'Barra @everyone/@here de quem não tem permissão para mencionar todos.',
    fields: {},
    defaults: { points: 2 },
  },
  mentions: {
    family: 'excess',
    label: 'Menções em massa',
    emoji: '👥',
    description: 'Limita quantos usuários e cargos uma mensagem pode mencionar.',
    fields: { max: int('Máximo de menções', 5, 1, 50) },
    defaults: { points: 2 },
  },
  caps: {
    family: 'excess',
    label: 'CAIXA ALTA',
    emoji: '🔠',
    description: 'Barra mensagens com maiúsculas demais. O mínimo de caracteres evita punir "OK".',
    fields: {
      percent: percent('Máximo de maiúsculas (%)', 70),
      minLength: int('Só a partir de quantos caracteres', 10, 4, 200),
    },
  },
  emojis: {
    family: 'excess',
    label: 'Excesso de emojis',
    emoji: '😵',
    description: 'Conta emojis normais e personalizados na mesma mensagem.',
    fields: { max: int('Máximo de emojis', 10, 1, 100) },
  },
  lines: {
    family: 'excess',
    label: 'Excesso de linhas',
    emoji: '📜',
    description: 'Barra o "muro de texto" que empurra a conversa para cima.',
    fields: { max: int('Máximo de linhas', 15, 2, 100) },
  },
  spoilers: {
    family: 'excess',
    label: 'Excesso de spoilers',
    emoji: '🫥',
    description: 'Muitos blocos ||spoiler|| costumam ser usados para esconder spam.',
    fields: { max: int('Máximo de spoilers', 5, 1, 50) },
  },
  zalgo: {
    family: 'excess',
    label: 'Zalgo',
    emoji: '👾',
    description: 'Texto com pilhas de acentos combinantes, que estica a linha e some com a leitura.',
    fields: { percent: percent('Densidade máxima de acentos (%)', 30) },
  },
  attachmentTypes: {
    family: 'excess',
    label: 'Tipos de arquivo',
    emoji: '📎',
    description: 'Bloqueia anexos por extensão. Uma por linha, com ou sem ponto.',
    fields: { extensions: list('Extensões bloqueadas', 'ex.: exe, bat, scr') },
    defaults: { points: 2 },
  },

  // ---- Links: precisam varrer a URL, mas ainda sem histórico. ----
  invites: {
    family: 'links',
    label: 'Convites do Discord',
    emoji: '✉️',
    description: 'Barra discord.gg e afins. Convites do próprio servidor podem ser liberados.',
    fields: { allowOwnServer: bool('Permitir convite deste servidor', true) },
    defaults: { points: 2 },
  },
  blockedDomains: {
    family: 'links',
    label: 'Domínios bloqueados',
    emoji: '⛔',
    description: 'Lista sempre barrada, mesmo que o domínio esteja na lista de permitidos.',
    fields: { domains: list('Domínios bloqueados', 'um por linha, ex.: grabify.link') },
    defaults: { points: 3 },
  },
  links: {
    family: 'links',
    label: 'Links em geral',
    emoji: '🔗',
    description: 'Barra qualquer link. Deixe a lista de permitidos vazia para barrar todos.',
    fields: { allowedDomains: list('Domínios permitidos', 'um por linha, ex.: youtube.com') },
  },

  // ---- Palavras: normalização de texto, custo médio. ----
  words: {
    family: 'words',
    label: 'Lista de palavras',
    emoji: '🤬',
    description: 'Palavras ou frases proibidas, uma por linha.',
    fields: {
      words: list('Palavras proibidas', 'uma por linha'),
      wholeWord: bool('Só palavra inteira', true, 'evita pegar "assistir" por causa de "sst"'),
      unmask: bool('Detectar disfarces', true, 'p4l4vr4, p-a-l-a-v-r-a, pallavra'),
    },
    defaults: { points: 2 },
  },
  patterns: {
    family: 'words',
    label: 'Padrões com curinga',
    emoji: '✳️',
    description: 'Use * para "qualquer coisa". Ex.: `compre*seguidores` pega o texto todo no meio.',
    fields: { patterns: list('Padrões', 'um por linha, ex.: ganhe*nitro*grátis') },
    defaults: { points: 2 },
  },

  // ---- Spam: dependem do histórico recente, então vêm por último. ----
  flood: {
    family: 'spam',
    label: 'Rajada de mensagens',
    emoji: '💨',
    description: 'Muitas mensagens em pouco tempo, independente do conteúdo.',
    fields: {
      messages: int('Mensagens', 5, 2, 30),
      windowSeconds: int('Em quantos segundos', 5, 1, 300),
    },
    defaults: { notify: 'dm' },
  },
  duplicate: {
    family: 'spam',
    label: 'Mensagem repetida',
    emoji: '♻️',
    description: 'O mesmo texto enviado várias vezes.',
    fields: {
      repeats: int('Repetições', 3, 2, 20),
      windowSeconds: int('Em quantos segundos', 30, 5, 600),
    },
  },
  crosspost: {
    family: 'spam',
    label: 'Spam entre canais',
    emoji: '📢',
    description: 'O mesmo texto espalhado por vários canais — o padrão clássico de divulgação.',
    fields: {
      channels: int('Canais diferentes', 3, 2, 20),
      windowSeconds: int('Em quantos segundos', 15, 5, 600),
    },
    defaults: { points: 3 },
  },
  attachmentSpam: {
    family: 'spam',
    label: 'Spam de anexos',
    emoji: '🖼️',
    description: 'Rajada de imagens, arquivos ou figurinhas.',
    fields: {
      attachments: int('Anexos', 5, 2, 30),
      windowSeconds: int('Em quantos segundos', 10, 1, 300),
    },
  },

  // ---- Raid: avaliadas na entrada do membro, não em mensagens. ----
  joinRate: {
    family: 'raid',
    label: 'Entrada em massa',
    emoji: '🚨',
    description:
      'Muitas entradas em pouco tempo ligam o alerta. Enquanto ele durar, quem entrar ' +
      'recebe a ação configurada. Nenhuma permissão de canal é alterada.',
    fields: {
      joins: int('Entradas', 10, 2, 100),
      windowSeconds: int('Em quantos segundos', 60, 5, 600),
      alertMinutes: int('Duração do alerta (min)', 10, 1, 720),
      suppressAutorole: bool('Não dar autorole durante o alerta', true),
    },
    defaults: { deleteMessage: false, points: 0, notify: 'none' },
  },
  suspiciousAccount: {
    family: 'raid',
    label: 'Conta suspeita',
    emoji: '🕵️',
    description:
      'Avalia quem entra: idade da conta, avatar e nome padrão do Discord. ' +
      'Sem autorole, o membro cai na verificação do /setup-verify.',
    fields: {
      minAccountAgeDays: int('Idade mínima da conta (dias)', 7, 0, 365),
      requireAvatar: bool('Exigir avatar', false),
      blockDefaultName: bool('Barrar nome padrão do Discord', false, 'ex.: usuario_12345'),
      suppressAutorole: bool('Não dar autorole', true),
    },
    defaults: { deleteMessage: false, points: 0, notify: 'dm' },
  },
});

const RULE_KEYS = Object.freeze(Object.keys(RULES));

/** Regras avaliadas em mensagens (todas menos a família raid). */
const MESSAGE_RULE_KEYS = Object.freeze(RULE_KEYS.filter((key) => RULES[key].family !== 'raid'));

/** Regras avaliadas na entrada de um membro. */
const RAID_RULE_KEYS = Object.freeze(RULE_KEYS.filter((key) => RULES[key].family === 'raid'));

/** Defaults completos de uma regra: base + sobrescritas + limites do catálogo. */
function ruleDefaults(key) {
  const rule = RULES[key];
  const limits = Object.fromEntries(
    Object.entries(rule.fields).map(([name, field]) => [name, field.default])
  );
  return { ...BASE_DEFAULTS, ...rule.defaults, limits };
}

module.exports = {
  FAMILIES,
  ACTIONS,
  NOTIFY_MODES,
  DEFAULT_MUTE_MS,
  BASE_DEFAULTS,
  RULES,
  RULE_KEYS,
  MESSAGE_RULE_KEYS,
  RAID_RULE_KEYS,
  ruleDefaults,
};
