/**
 * Detectores da família "links e convites".
 *
 * A detecção não exige `http://`: quem quer burlar escreve `site .com` ou só
 * `site.com`. Por outro lado, aceitar qualquer `algo.algo` como link
 * transformaria "index.js", "arquivo.exe" e "versão 1.2" em infração. O meio
 * termo é exigir um TLD conhecido — a lista abaixo cobre o que aparece em
 * divulgação e golpe, e é o suficiente para não punir conversa normal.
 */

const { toPlain } = require('../textNormalize');

/** TLDs reconhecidos como link. Curta e prática, não exaustiva. */
const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'io', 'gg', 'br', 'co', 'me', 'tv', 'app', 'dev', 'xyz',
  'online', 'site', 'store', 'shop', 'club', 'live', 'link', 'info', 'biz',
  'pro', 'top', 'vip', 'fun', 'icu', 'cc', 'ly', 'to', 'sh', 'gl', 'ru', 'cn',
  'de', 'fr', 'es', 'it', 'uk', 'us', 'ca', 'au', 'pt', 'ar', 'mx', 'cl',
  'net.br', 'com.br', 'org.br', 'gov.br', 'edu.br',
]);

/** Domínios de convite do Discord e encurtadores conhecidos de convite. */
const INVITE_HOSTS = ['discord.gg', 'discord.com/invite', 'discordapp.com/invite', 'discord.me', 'dsc.gg', 'invite.gg'];

/** Quanto tempo a lista de convites do servidor fica em cache. */
const OWN_INVITES_TTL_MS = 5 * 60 * 1000;

/** `guildId` -> { codes: Set<string>, at: number }. */
const ownInvitesCache = new Map();

/**
 * Texto preparado para busca de link: desfaz as formas clássicas de disfarce.
 *
 * Só o ponto **disfarçado** é colado — `site [.] com`, `site (ponto) com`,
 * `hxxp://`. Ponto seguido de espaço fica como está de propósito: colar tudo
 * transformaria "obrigado. com certeza" em `obrigado.com` e a frase viraria
 * infração de link.
 */
function linkifiable(content) {
  return toPlain(content)
    .replace(/h[x*]{2}(ps?):\/\//g, 'htt$1://')
    .replace(/\s*[[({<]\s*(?:\.|dot|ponto)\s*[\])}>]\s*/g, '.')
    .replace(/\s+(?:dot|ponto)\s+/g, '.');
}

/**
 * Domínios citados no texto.
 * @returns {string[]} hosts em minúsculas, sem `www.`
 */
function extractDomains(content) {
  const text = linkifiable(content);
  const found = new Set();

  // Sequências tipo "sub.dominio.tld", com ou sem esquema na frente.
  for (const match of text.matchAll(/(?:https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/g)) {
    const host = match[1].replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length < 2) continue;

    const tld = parts.at(-1);
    const twoLevel = parts.slice(-2).join('.');
    if (KNOWN_TLDS.has(tld) || KNOWN_TLDS.has(twoLevel)) found.add(host);
  }

  return [...found];
}

/** True quando `host` é o domínio da lista ou um subdomínio dele. */
const matchesDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** Códigos de convite citados no texto. */
function extractInviteCodes(content) {
  const text = linkifiable(content);
  const codes = new Set();

  for (const match of text.matchAll(/(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|dsc\.gg|invite\.gg)\/([a-z0-9-]{2,32})/g)) {
    codes.add(match[1]);
  }
  return [...codes];
}

/**
 * Códigos de convite do próprio servidor, em cache.
 *
 * Listar convites exige `ManageGuild`. Sem essa permissão o Set volta vazio e a
 * verificação cai no `fetchInvite`, que é público.
 */
async function ownInviteCodes(guild) {
  const cached = ownInvitesCache.get(guild.id);
  if (cached && Date.now() - cached.at < OWN_INVITES_TTL_MS) return cached.codes;

  const invites = await guild.invites.fetch().catch(() => null);
  const codes = new Set(invites ? invites.map((invite) => invite.code) : []);
  ownInvitesCache.set(guild.id, { codes, at: Date.now() });
  return codes;
}

/**
 * O convite aponta para este mesmo servidor?
 *
 * Em caso de dúvida devolve `false` (ou seja: trata como convite externo e
 * bloqueia). Um filtro que libera o que não conseguiu verificar não filtra nada,
 * e o convite do próprio servidor tende a estar na lista em cache.
 */
async function isOwnInvite(guild, code) {
  const own = await ownInviteCodes(guild);
  if (own.has(code)) return true;
  if (guild.vanityURLCode && guild.vanityURLCode === code) return true;

  const invite = await guild.client.fetchInvite(code).catch(() => null);
  return invite?.guild?.id === guild.id;
}

const detectors = {
  async invites({ content, guild }, limits) {
    const codes = extractInviteCodes(content);
    if (!codes.length) return null;

    if (!limits.allowOwnServer) return { detail: `convite: discord.gg/${codes[0]}` };

    for (const code of codes) {
      // eslint-disable-next-line no-await-in-loop -- raro ter dois convites; sequencial evita rajada de REST
      if (!(await isOwnInvite(guild, code))) return { detail: `convite externo: discord.gg/${code}` };
    }
    return null;
  },

  blockedDomains({ content }, limits) {
    if (!limits.domains.length) return null;

    const hosts = extractDomains(content);
    for (const host of hosts) {
      const hit = limits.domains.find((domain) => matchesDomain(host, domain.replace(/^www\./, '')));
      if (hit) return { detail: `domínio bloqueado: ${host}` };
    }
    return null;
  },

  links({ content }, limits) {
    const hosts = extractDomains(content);
    if (!hosts.length) return null;

    const allowed = limits.allowedDomains.map((domain) => domain.replace(/^www\./, ''));
    const offender = hosts.find((host) => !allowed.some((domain) => matchesDomain(host, domain)));
    if (!offender) return null;

    return { detail: allowed.length ? `link não permitido: ${offender}` : `link: ${offender}` };
  },
};

/** Só para os testes: limpa o cache de convites. */
const resetInviteCache = () => ownInvitesCache.clear();

module.exports = {
  KNOWN_TLDS,
  INVITE_HOSTS,
  detectors,
  linkifiable,
  extractDomains,
  extractInviteCodes,
  matchesDomain,
  isOwnInvite,
  resetInviteCache,
};
