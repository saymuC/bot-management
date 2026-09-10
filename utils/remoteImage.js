// @ts-check
/**
 * Download de imagem a partir de uma URL escolhida por um usuário do bot.
 *
 * Duas coisas moram aqui porque toda funcionalidade que baixa imagem precisa das
 * duas: barrar alvos internos e baixar validando o caminho inteiro. Nasceu no
 * `/emoji-add` e foi extraído quando o fundo do ranking passou a precisar do
 * mesmo cuidado com um limite de tamanho diferente.
 */

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/**
 * O bot baixa uma URL escolhida por quem roda o comando, então vale barrar
 * alvos internos. A checagem é por hostname (não resolve DNS), o que cobre os
 * casos óbvios; quem chama ainda exige permissão de administração do servidor.
 *
 * @param {unknown} raw
 * @returns {{ok: true, url: URL} | {ok: false, error: string}}
 */
function checkPublicUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return { ok: false, error: 'Esse link não é uma URL válida.' };
  }

  if (url.protocol !== 'https:') return { ok: false, error: 'Use um link `https://`.' };

  const host = url.hostname.toLowerCase();
  const isIpLiteral = IPV4_RE.test(host) || host.includes(':') || host.startsWith('[');
  const isLocal = host === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix));

  if (isIpLiteral || isLocal) return { ok: false, error: 'Esse endereço não é público. Use um link de imagem normal.' };

  return { ok: true, url };
}

/**
 * Baixa a imagem validando destino, tipo e tamanho **em cada redirecionamento**.
 *
 * Redirecionamento é seguido à mão de propósito: com `redirect: 'follow'` o
 * `fetch` levaria o bot a um endereço interno sem passar por `checkPublicUrl` de
 * novo, e a checagem da primeira URL não valeria nada.
 *
 * @param {string} url
 * @param {{ maxBytes: number, tooLarge?: (kb: number) => string, notFound?: string }} options
 * @returns {Promise<{ok: true, bytes: Buffer, contentType: string} | {ok: false, error: string}>}
 */
async function fetchRemoteImage(url, { maxBytes, tooLarge, notFound }) {
  const tooLargeMessage =
    tooLarge ?? ((kb) => `A imagem tem ${kb} KB. O limite aqui é ${Math.round(maxBytes / 1024)} KB.`);

  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = checkPublicUrl(current);
    if (!checked.ok) return checked;

    let res;
    try {
      res = await fetch(checked.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const cause = err instanceof Error ? (err.name === 'TimeoutError' ? 'tempo esgotado' : err.message) : String(err);
      return { ok: false, error: `Não consegui baixar a imagem (${cause}).` };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, error: 'O link redirecionou para lugar nenhum.' };
      current = new URL(location, checked.url).toString();
      continue;
    }

    if (!res.ok) {
      return {
        ok: false,
        error: res.status === 404 ? (notFound ?? 'Imagem não encontrada nesse link.') : `O servidor da imagem respondeu ${res.status}.`,
      };
    }

    const contentType = String(res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('image/')) return { ok: false, error: 'Esse link não aponta para uma imagem.' };

    // O `content-length` é conferido antes de ler o corpo: é o que evita puxar
    // um arquivo enorme só para descobrir depois que ele não serve.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, error: tooLargeMessage(Math.round(declared / 1024)) };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > maxBytes) return { ok: false, error: tooLargeMessage(Math.round(bytes.length / 1024)) };

    return { ok: true, bytes, contentType };
  }

  return { ok: false, error: 'O link redirecionou vezes demais.' };
}

module.exports = { MAX_REDIRECTS, REQUEST_TIMEOUT_MS, checkPublicUrl, fetchRemoteImage };
