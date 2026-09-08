/**
 * Paleta de cores nomeadas usada pelo /embed e pelo /setup-welcome.
 *
 * A ideia é a pessoa poder digitar "azul" em vez de decorar `#3498DB`, mas sem
 * perder a opção de informar um hex livre. Por isso `resolveColor` aceita os
 * dois formatos, e os seletores/autocomplete oferecem apenas os nomes.
 */

const { parseHexColor } = require('./embeds');

/** Ordem importa: é a ordem exibida no autocomplete e nos select menus. */
const PALETTE = [
  { key: 'blurple', label: 'Azul Discord', emoji: '🟦', hex: 0x5865f2, aliases: ['discord', 'azuldiscord'] },
  { key: 'azul', label: 'Azul', emoji: '🔵', hex: 0x3498db, aliases: ['blue'] },
  { key: 'azul-marinho', label: 'Azul Marinho', emoji: '🌊', hex: 0x206694, aliases: ['navy', 'azulescuro'] },
  { key: 'ciano', label: 'Ciano', emoji: '🩵', hex: 0x1abc9c, aliases: ['cyan', 'turquesa', 'teal'] },
  { key: 'verde', label: 'Verde', emoji: '🟢', hex: 0x2ecc71, aliases: ['green'] },
  { key: 'verde-discord', label: 'Verde Discord', emoji: '🟩', hex: 0x57f287, aliases: ['greendiscord'] },
  { key: 'verde-escuro', label: 'Verde Escuro', emoji: '🌿', hex: 0x1f8b4c, aliases: ['darkgreen'] },
  { key: 'amarelo', label: 'Amarelo', emoji: '🟡', hex: 0xf1c40f, aliases: ['yellow'] },
  { key: 'dourado', label: 'Dourado', emoji: '🥇', hex: 0xd4af37, aliases: ['gold', 'ouro'] },
  { key: 'laranja', label: 'Laranja', emoji: '🟠', hex: 0xe67e22, aliases: ['orange'] },
  { key: 'vermelho', label: 'Vermelho', emoji: '🔴', hex: 0xe74c3c, aliases: ['red'] },
  { key: 'vermelho-discord', label: 'Vermelho Discord', emoji: '🟥', hex: 0xed4245, aliases: ['reddiscord'] },
  { key: 'vinho', label: 'Vinho', emoji: '🍷', hex: 0x992d22, aliases: ['darkred', 'bordo'] },
  { key: 'rosa', label: 'Rosa', emoji: '🩷', hex: 0xe91e63, aliases: ['pink'] },
  { key: 'fucsia', label: 'Fúcsia', emoji: '🌸', hex: 0xeb459e, aliases: ['fuchsia', 'magenta'] },
  { key: 'roxo', label: 'Roxo', emoji: '🟣', hex: 0x9b59b6, aliases: ['purple'] },
  { key: 'indigo', label: 'Índigo', emoji: '🫐', hex: 0x5b2c6f, aliases: ['violeta'] },
  { key: 'marrom', label: 'Marrom', emoji: '🟤', hex: 0x8b5a2b, aliases: ['brown'] },
  { key: 'cinza', label: 'Cinza', emoji: '🩶', hex: 0x95a5a6, aliases: ['gray', 'grey'] },
  { key: 'prata', label: 'Prata', emoji: '🥈', hex: 0xc0c0c0, aliases: ['silver'] },
  { key: 'branco', label: 'Branco', emoji: '⚪', hex: 0xffffff, aliases: ['white'] },
  // 0x000000 é interpretado pelo Discord como "sem cor"; 0x010101 aparece preto.
  { key: 'preto', label: 'Preto', emoji: '⚫', hex: 0x010101, aliases: ['black'] },
  { key: 'escuro', label: 'Escuro (tema)', emoji: '🌙', hex: 0x2b2d31, aliases: ['dark', 'darktheme'] },
];

/** Normaliza para busca: sem acento, minúsculo, sem espaços/hífens. */
function normalizeKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_-]/g, '');
}

const byName = new Map();
for (const entry of PALETTE) {
  byName.set(normalizeKey(entry.key), entry);
  byName.set(normalizeKey(entry.label), entry);
  for (const alias of entry.aliases) byName.set(normalizeKey(alias), entry);
}

/** @returns {(typeof PALETTE)[number]|null} entrada da paleta pelo nome/alias. */
function findNamedColor(raw) {
  return byName.get(normalizeKey(raw)) ?? null;
}

/**
 * Converte nome da paleta OU hex em inteiro de cor.
 * @returns {number|null} null quando não reconhece o valor.
 */
function resolveColor(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return null;
  return findNamedColor(input)?.hex ?? parseHexColor(input);
}

/** Texto amigável da cor guardada no rascunho/config (nome quando conhecido). */
function describeColor(raw) {
  if (!raw) return 'padrão';
  const named = findNamedColor(raw);
  if (named) return `${named.emoji} ${named.label}`;
  const hex = parseHexColor(raw);
  return hex === null ? 'padrão' : `\`#${hex.toString(16).padStart(6, '0').toUpperCase()}\``;
}

/**
 * Opções para StringSelectMenu (limite de 25 do Discord).
 * @param {string|null} selected valor atualmente escolhido, para marcar default.
 */
function colorSelectOptions(selected) {
  const current = findNamedColor(selected)?.key ?? null;
  return PALETTE.slice(0, 25).map((entry) => ({
    label: entry.label,
    value: entry.key,
    emoji: entry.emoji,
    description: `#${entry.hex.toString(16).padStart(6, '0').toUpperCase()}`,
    default: entry.key === current,
  }));
}

/**
 * Sugestões de autocomplete: nomes da paleta filtrados, mais o hex digitado.
 * @returns {{ name: string, value: string }[]} até 25 itens.
 */
function colorAutocomplete(query) {
  const term = normalizeKey(query);
  const suggestions = [];

  if (parseHexColor(query) !== null) {
    suggestions.push({ name: `Hex personalizado: ${query.trim()}`, value: query.trim() });
  }

  for (const entry of PALETTE) {
    if (term && !normalizeKey(entry.label).includes(term) && !normalizeKey(entry.key).includes(term)) continue;
    suggestions.push({ name: `${entry.emoji} ${entry.label}`, value: entry.key });
    if (suggestions.length >= 25) break;
  }
  return suggestions;
}

module.exports = { PALETTE, findNamedColor, resolveColor, describeColor, colorSelectOptions, colorAutocomplete };
