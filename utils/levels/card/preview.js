// @ts-check
/**
 * A imagem de amostra da tela `Aparência` do `/levelconfig`.
 *
 * Não é um render novo: chama os mesmos `renderLeaderboardCard` e `renderRankCard`
 * que os comandos usam. Um desenho paralelo só para o preview seria uma segunda
 * verdade — o admin ajustaria a cor vendo uma imagem que o `/top` não produz.
 *
 * Os dados são **reais** do servidor, completados com linhas de exemplo quando
 * ainda não há gente suficiente: um preview de ranking vazio não mostraria pódio,
 * medalha nem barra, que é justamente o que está sendo configurado. Quem chamou
 * recebe `demo: true` para poder dizer isso no painel em vez de deixar o admin
 * achando que aquelas pessoas existem.
 */

const { leaderboardPage, participantCount, getXp, rankOf } = require('../repository');
const { renderLeaderboardCard } = require('./leaderboardCard');
const { renderRankCard } = require('./rankCard');
const { resolveVisual } = require('./visual');
const { resolveEntries } = require('../../../handlers/levelsLeaderboardHandler');

/**
 * Quantas linhas o preview mostra.
 *
 * Quatro, e não dez: entra o destaque do primeiro lugar, o pódio inteiro (as três
 * medalhas) e uma linha comum, que é tudo que o tema muda de forma. Dez linhas
 * seriam uma tira de mais de 1400 px para não mostrar nada novo, redesenhada a cada
 * clique do admin.
 */
const PREVIEW_ROWS = 4;

/** XP dos participantes fictícios: decrescente, com folga entre eles. */
const DEMO_ENTRIES = Object.freeze([
  Object.freeze({ id: 'demo-1', name: 'Ada', totalXp: 18_400 }),
  Object.freeze({ id: 'demo-2', name: 'Bruno', totalXp: 12_150 }),
  Object.freeze({ id: 'demo-3', name: 'Clara', totalXp: 7_320 }),
  Object.freeze({ id: 'demo-4', name: 'Dinho', totalXp: 2_680 }),
]);

/** XP do card de exemplo do `/rank`, para quem abre o painel sem ter pontuado. */
const DEMO_RANK_XP = 4_500;

/**
 * @typedef {Object} AppearancePreview
 * @property {Buffer|null} image PNG, ou `null` quando o host não pode desenhar
 * @property {boolean} demo a imagem usou pelo menos uma linha de exemplo
 * @property {string} signature assinatura do visual, para o nome do arquivo
 */

/**
 * As primeiras posições reais do ranking, já com nome e avatar resolvidos.
 *
 * @param {import('discord.js').Guild} guild
 * @param {number} limit
 * @returns {Promise<import('./leaderboardCard').LeaderboardEntry[]>}
 */
async function realEntries(guild, limit) {
  const rows = leaderboardPage(guild.id, limit, 0);
  if (!rows.length) return [];

  const resolved = await resolveEntries(
    guild,
    rows.map((row) => row.user_id)
  );

  return rows.map((row, index) => {
    const info = resolved.get(row.user_id);
    return {
      position: index + 1,
      id: row.user_id,
      name: info?.name ?? row.user_id,
      avatarUrl: info?.avatarUrl ?? null,
      totalXp: row.xp,
    };
  });
}

/**
 * Linhas de exemplo para as posições que faltam.
 *
 * O XP fictício é rebaixado para ficar abaixo da última linha real, senão a lista
 * apareceria fora de ordem — o ranking é ordenado por XP e um exemplo com 18 mil no
 * fim de uma lista de gente com 30 mil leria como bug do bot.
 *
 * @param {import('./leaderboardCard').LeaderboardEntry[]} entries linhas reais
 * @param {number} target quantas linhas o preview quer
 * @returns {import('./leaderboardCard').LeaderboardEntry[]}
 */
function padWithDemo(entries, target) {
  const missing = Math.max(0, target - entries.length);
  if (!missing) return entries;

  const last = entries.at(-1);
  const ceiling = last ? Math.max(1, Math.floor(last.totalXp * 0.7)) : null;
  const biggest = DEMO_ENTRIES[0].totalXp;

  const filler = DEMO_ENTRIES.slice(0, missing).map((demo, index) => ({
    position: entries.length + index + 1,
    id: demo.id,
    name: demo.name,
    avatarUrl: null,
    totalXp: ceiling === null ? demo.totalXp : Math.max(1, Math.round((demo.totalXp / biggest) * ceiling)),
  }));

  return [...entries, ...filler];
}

/**
 * Preview da imagem do `/top` com o tema informado.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('../types').LevelsConfig} config
 * @returns {Promise<AppearancePreview>}
 */
async function previewTop(guild, config) {
  const total = participantCount(guild.id);
  const real = await realEntries(guild, PREVIEW_ROWS);
  const entries = padWithDemo(real, PREVIEW_ROWS);

  const image = await renderLeaderboardCard({
    guildId: guild.id,
    guildName: guild.name,
    page: 1,
    pages: Math.max(1, Math.ceil(Math.max(total, entries.length) / PREVIEW_ROWS)),
    total: Math.max(total, entries.length),
    pageSize: PREVIEW_ROWS,
    entries,
    headline: config.headline,
    backgroundUrl: config.backgroundUrl,
    theme: config.theme,
  });

  return { image, demo: entries.length > real.length, signature: resolveVisual(config.theme).signature };
}

/**
 * Preview da imagem do `/rank`, com o progresso de quem está configurando.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember|null} member
 * @param {import('../types').LevelsConfig} config
 * @returns {Promise<AppearancePreview>}
 */
async function previewRank(guild, member, config) {
  const total = participantCount(guild.id);
  const realXp = member ? getXp(guild.id, member.id) : 0;
  const demo = realXp <= 0;

  const totalXp = demo ? DEMO_RANK_XP : realXp;
  const position = demo ? 3 : rankOf(guild.id, member?.id ?? '', realXp);

  const image = await renderRankCard({
    name: demo && !member ? DEMO_ENTRIES[0].name : (member?.displayName ?? DEMO_ENTRIES[0].name),
    avatarUrl: member?.displayAvatarURL({ extension: 'png', size: 128 }) ?? null,
    totalXp,
    position,
    participants: Math.max(total, 3),
    headline: config.headline,
    backgroundUrl: config.backgroundUrl,
    theme: config.theme,
  });

  return { image, demo, signature: resolveVisual(config.theme).signature };
}

/**
 * PNG de amostra da aparência configurada.
 *
 * Nunca lança, pelo mesmo motivo dos outros renders: o painel de configuração tem
 * de abrir mesmo em host sem fonte, com a URL de fundo fora do ar ou com o banco
 * respondendo estranho. `image: null` faz a tela virar só o formulário.
 *
 * @param {{ guild: import('discord.js').Guild, member?: import('discord.js').GuildMember|null, config: import('../types').LevelsConfig, mode?: 'top'|'rank' }} options
 * @returns {Promise<AppearancePreview>}
 */
async function renderAppearancePreview({ guild, member = null, config, mode = 'top' }) {
  try {
    return mode === 'rank' ? await previewRank(guild, member, config) : await previewTop(guild, config);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    console.error('[levels] falha ao desenhar o preview da aparência:', motivo);
    return { image: null, demo: false, signature: 'erro' };
  }
}

module.exports = { PREVIEW_ROWS, DEMO_ENTRIES, DEMO_RANK_XP, padWithDemo, renderAppearancePreview };
