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
const https = require('node:https');
const net = require('node:net');

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
  const addr = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (addr.includes('%')) return true;

  // `::ffff:1.2.3.4` e `::1.2.3.4` são um IPv4 escrito em IPv6 — vale a mesma tabela.
  const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  const v4 = ipv4ToInt(mapped ? mapped[1] : addr);
  if (v4 !== null) {
    return IPV4_BLOCKED.some(([base, bits]) => {
      const mask = (0xffffffff << (32 - bits)) >>> 0;
      return (v4 & mask) === ((ipv4ToInt(base) ?? 0) & mask);
    });
  }

  if (net.isIP(addr) !== 6) return true;
  // Apenas unicast global nativo; túneis (6to4/Teredo) e prefixos especiais
  // podem encapsular um IPv4 privado mesmo com um endereço IPv6 público.
  const groups = addr.split(':');
  const first = Number.parseInt(groups[0], 16);
  const second = Number.parseInt(groups[1], 16);
  return (first & 0xe000) !== 0x2000 || (first === 0x2001 && (second === 0 || second === 0xdb8)) || first === 0x2002;
}

/**
 * Resolve o hostname e recusa se **qualquer** IP retornado for interno.
 *
 * O `checkPublicUrl` sozinho não fecha o SSRF: um domínio público pode apontar
 * para `127.0.0.1` ou para o metadata da cloud. Aqui a resolução acontece antes
 * de qualquer byte sair.
 *
 * @param {URL} url
 * @returns {Promise<{ok: true, address: string, family: number} | {ok: false, error: string}>}
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

  return { ok: true, address: addresses[0].address, family: addresses[0].family };
}

/** @param {URL} url @param {{address: string, family: number}} resolved */
function requestPinned(url, resolved) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      agent: false,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // O hostname da URL continua sendo usado para Host, SNI e certificado.
      // O socket nunca consulta DNS outra vez, inclusive depois de um redirect.
      lookup: (_host, _options, callback) => callback(null, resolved.address, resolved.family),
    }, resolve);
    req.once('error', reject);
  });
}

/**
 * Lê o corpo em pedaços e aborta no primeiro byte acima do limite.
 *
 * Sem isto, um servidor que omite `content-length` faz o bot puxar o arquivo
 * inteiro na memória só para rejeitá-lo depois — o limite de tamanho não
 * protegeria nada contra quem manda um arquivo de gigabytes.
 *
 * @param {{body: AsyncIterable<Uint8Array>|null}} res
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
 * Redirecionamento é seguido à mão de propósito: seguir automaticamente
 * levaria o bot a um endereço interno sem passar por `checkPublicUrl` de
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
      res = await requestPinned(checked.url, resolved);
    } catch (err) {
      const cause = err instanceof Error ? (err.name === 'AbortError' || err.name === 'TimeoutError' ? 'tempo esgotado' : err.message) : String(err);
      return { ok: false, error: `Não consegui baixar a imagem (${cause}).` };
    }

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      res.destroy();
      if (!location) return { ok: false, error: 'O link redirecionou para lugar nenhum.' };
      try { current = new URL(location, checked.url).toString(); }
      catch { return { ok: false, error: 'O link redirecionou para uma URL inválida.' }; }
      continue;
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.destroy();
      return {
        ok: false,
        error: res.statusCode === 404 ? (notFound ?? 'Imagem não encontrada nesse link.') : `O servidor da imagem respondeu ${res.statusCode}.`,
      };
    }

    const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      res.destroy();
      return { ok: false, error: 'Esse link não aponta para uma imagem.' };
    }

    // O `content-length` é conferido antes de ler o corpo: é o que evita puxar
    // um arquivo enorme só para descobrir depois que ele não serve.
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      return { ok: false, error: tooLargeMessage(Math.round(declared / 1024)) };
    }

    // Sem `content-length` (ou com um mentiroso), o corte real acontece aqui.
    const body = await readCapped({ body: res }, maxBytes).catch(() => null);
    res.destroy();
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
