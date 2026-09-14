// @ts-check
/**
 * Download de imagem a partir de uma URL escolhida por um usuário do bot.
 *
 * Duas coisas moram aqui porque toda funcionalidade que baixa imagem precisa das
 * duas: barrar alvos internos e baixar validando o caminho inteiro. Nasceu no
 * `/emoji-add` e foi extraído quando o fundo do ranking passou a precisar do
 * mesmo cuidado com um limite de tamanho diferente.
 */

const dns = require('node:dns').promises;

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/**
 * Faixas IPv4 que não são internet pública: rede local, loopback, link-local
 * (onde vive o metadata das clouds, `169.254.169.254`), CGNAT, multicast e
 * reservadas. É a lista que fecha o SSRF quando o hostname é público mas o DNS
 * aponta para dentro.
 *
 * @type {ReadonlyArray<readonly [string, number]>}
 */
const IPV4_BLOCKED = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** @param {string} ip @returns {number|null} */
function ipv4ToInt(ip) {
  if (!IPV4_RE.test(ip)) return null;
  const parts = ip.split('.').map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Um IP é liberado só quando reconhecemos o formato **e** ele está fora das
 * faixas reservadas. Qualquer coisa que não sabemos ler volta como privada:
 * numa checagem de segurança, o desconhecido é o caso perigoso.
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIp(ip) {
  const addr = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];

  // `::ffff:1.2.3.4` e `::1.2.3.4` são um IPv4 escrito em IPv6 — vale a mesma tabela.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  const v4 = ipv4ToInt(mapped ? mapped[1] : addr);
  if (v4 !== null) {
    return IPV4_BLOCKED.some(([base, bits]) => {
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (v4 & mask) === ((ipv4ToInt(base) ?? 0) & mask);
    });
  }

  if (!addr.includes(':')) return true;
  if (addr === '::' || addr === '::1') return true;
  if (addr.startsWith('64:ff9b:')) return true; // NAT64: embrulha um IPv4 qualquer

  const first = Number.parseInt(addr.split(':')[0] || '0', 16);
  if (!Number.isFinite(first)) return true;
  if ((first >> 8) === 0xfc || (first >> 8) === 0xfd) return true; // fc00::/7 (uso local)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 (site-local, obsoleto mas ainda roteado)
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 (multicast)

  return false;
}

/**
 * Resolve o hostname e recusa se **qualquer** IP retornado for interno.
 *
 * O `checkPublicUrl` sozinho não fecha o SSRF: um domínio público pode apontar
 * para `127.0.0.1` ou para o metadata da cloud. Aqui a resolução acontece antes
 * de qualquer byte sair.
 *
 * ponytail: sobra a janela de DNS rebinding (o `fetch` resolve de novo por
 * conta dele). Fechar de verdade exige conectar no IP já validado com o Host
 * original — trocar por um agente customizado se isso virar requisito.
 *
 * @param {URL} url
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
async function checkResolvedHost(url) {
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: 'Não consegui resolver o endereço desse link.' };
  }

  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    return { ok: false, error: 'Esse endereço não é público. Use um link de imagem normal.' };
  }

  return { ok: true };
}

/**
 * Lê o corpo em pedaços e aborta no primeiro byte acima do limite.
 *
 * Sem isto, um servidor que omite `content-length` faz o bot puxar o arquivo
 * inteiro na memória só para rejeitá-lo depois — o limite de tamanho não
 * protegeria nada contra quem manda um arquivo de gigabytes.
 *
 * @param {Response} res
 * @param {number} maxBytes
 * @returns {Promise<{ok: true, bytes: Buffer} | {ok: false, seen: number}>}
 */
async function readCapped(res, maxBytes) {
  if (!res.body) return { ok: true, bytes: Buffer.alloc(0) };

  /** @type {Buffer[]} */
  const chunks = [];
  let seen = 0;

  // Sair do `for await` cancela o stream, então a conexão morre junto.
  for await (const chunk of res.body) {
    const part = Buffer.from(chunk);
    seen += part.length;
    if (seen > maxBytes) return { ok: false, seen };
    chunks.push(part);
  }

  return { ok: true, bytes: Buffer.concat(chunks) };
}

/**
 * Checagem síncrona e barata do formato: protocolo, IP literal e nomes locais.
 * Serve para validar o que o usuário digitou antes de gravar em config, sem
 * pagar uma consulta DNS. A resolução de verdade fica no `checkResolvedHost`,
 * que `fetchRemoteImage` chama a cada hop.
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

    const resolved = await checkResolvedHost(checked.url);
    if (!resolved.ok) return resolved;

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

    // Sem `content-length` (ou com um mentiroso), o corte real acontece aqui.
    const body = await readCapped(res, maxBytes).catch(() => null);
    if (!body) return { ok: false, error: 'Não consegui baixar a imagem (conexão interrompida).' };
    if (!body.ok) return { ok: false, error: tooLargeMessage(Math.round(body.seen / 1024)) };

    return { ok: true, bytes: body.bytes, contentType };
  }

  return { ok: false, error: 'O link redirecionou vezes demais.' };
}

module.exports = {
  MAX_REDIRECTS,
  REQUEST_TIMEOUT_MS,
  checkPublicUrl,
  checkResolvedHost,
  isPrivateIp,
  readCapped,
  fetchRemoteImage,
};
