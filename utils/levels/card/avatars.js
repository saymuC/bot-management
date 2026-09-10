// @ts-check
/**
 * Download e cache dos avatares que aparecem nas imagens do ranking.
 *
 * Uma página do `/top` precisa de dez imagens do CDN do Discord. Em série isso
 * seria meio segundo de espera por linha; aqui é tudo em paralelo, com timeout
 * curto, e o que não chegar vira a reserva desenhada (círculo com a inicial).
 *
 * O CDN devolve URL com o hash do arquivo no caminho, então a própria URL é a
 * chave de cache: avatar trocado gera URL nova e a entrada velha simplesmente
 * expira sem ninguém precisar invalidar nada.
 */

const { loadImage } = require('@napi-rs/canvas');
const { createCache } = require('./cache');

/** @typedef {import('@napi-rs/canvas').Image} CanvasImage */

const AVATAR_TTL_MS = 30 * 60 * 1000;
/** Cabe umas 12 páginas cheias de gente diferente; acima disso o mais antigo sai. */
const AVATAR_MAX_ENTRIES = 128;
const AVATAR_TIMEOUT_MS = 4000;
/** Um PNG de 128 px não passa disso; qualquer coisa maior não é o que pedimos. */
const AVATAR_MAX_BYTES = 512 * 1024;

/** @type {ReturnType<typeof createCache<CanvasImage|null>>} */
const avatarCache = createCache({ ttlMs: AVATAR_TTL_MS, max: AVATAR_MAX_ENTRIES });

/**
 * Baixa os bytes de um avatar do CDN do Discord.
 *
 * Não passa pelo `checkPublicUrl` porque a URL não vem do usuário: é construída
 * por `displayAvatarURL()` a partir do id e do hash. O que se protege aqui é
 * outra coisa — tempo de espera e tamanho de resposta.
 *
 * @param {string} url
 * @returns {Promise<Buffer|null>}
 */
async function fetchAvatarBytes(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS) });
    if (!res.ok) return null;

    const contentType = String(res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > AVATAR_MAX_BYTES ? null : bytes;
  } catch {
    // Timeout, DNS, socket: nada aqui merece log. Avatar que não vem tem reserva.
    return null;
  }
}

/**
 * Avatar decodificado de uma URL, ou `null`.
 *
 * O `null` entra no cache junto com o sucesso: se o CDN recusar uma URL, insistir
 * dez vezes por página não muda o resultado, só atrasa a imagem.
 *
 * @param {string|null|undefined} url
 * @param {{ fetcher?: (url: string) => Promise<Buffer|null>, decoder?: typeof loadImage }} [deps]
 * @returns {Promise<CanvasImage|null>}
 */
async function loadAvatar(url, deps = {}) {
  if (!url) return null;

  const cached = avatarCache.get(url);
  if (cached !== undefined) return cached;

  const fetcher = deps.fetcher ?? fetchAvatarBytes;
  const decoder = deps.decoder ?? loadImage;

  try {
    const bytes = await fetcher(url);
    if (!bytes) return avatarCache.set(url, null);
    return avatarCache.set(url, await decoder(bytes));
  } catch {
    return avatarCache.set(url, null);
  }
}

/**
 * Carrega vários avatares de uma vez.
 *
 * URLs repetidas são baixadas uma única vez (o `Set`), e cada falha é isolada —
 * uma imagem que não vem não impede as outras, porque `loadAvatar` já resolve com
 * `null` em vez de rejeitar.
 *
 * @param {Array<string|null|undefined>} urls
 * @param {{ fetcher?: (url: string) => Promise<Buffer|null>, decoder?: typeof loadImage }} [deps]
 * @returns {Promise<Map<string, CanvasImage|null>>}
 */
async function loadAvatars(urls, deps = {}) {
  const unique = [...new Set(urls.filter((url) => typeof url === 'string' && url !== ''))].map(String);
  const images = await Promise.all(unique.map((url) => loadAvatar(url, deps)));
  return new Map(unique.map((url, index) => [url, images[index]]));
}

module.exports = {
  AVATAR_TTL_MS,
  AVATAR_MAX_ENTRIES,
  AVATAR_TIMEOUT_MS,
  AVATAR_MAX_BYTES,
  avatarCache,
  fetchAvatarBytes,
  loadAvatar,
  loadAvatars,
};
