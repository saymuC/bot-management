/**
 * Resolve de onde vem a imagem de um emoji novo (para o /emoji-add).
 *
 * Aceita três origens: um emoji personalizado colado no comando, o ID cru dele
 * ou um link de imagem. A imagem é baixada aqui — e não entregue como URL ao
 * discord.js — para o comando poder recusar arquivo grande demais com uma
 * mensagem clara em vez de deixar a API devolver um erro genérico.
 */

const { parseCustomEmoji } = require('./emojis');

/** Limite do Discord para imagem de emoji. */
const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];

/**
 * O bot baixa uma URL escolhida por quem roda o comando, então vale barrar
 * alvos internos. A checagem é por hostname (não resolve DNS), o que cobre os
 * casos óbvios; o comando ainda exige permissão de gerenciar expressões.
 *
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

/** Nome válido de emoji: 2 a 32 caracteres de `[A-Za-z0-9_]`. */
function sanitizeEmojiName(raw, fallback = 'emoji') {
  const clean = String(raw ?? '')
    .trim()
    .replace(/[^\w]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  if (clean.length >= 2) return clean;
  // Nome curto demais viraria erro 50035 na API; melhor completar.
  return (clean || fallback).padEnd(2, '_').slice(0, 32);
}

/** URL do CDN para um emoji já existente em algum servidor. */
function cdnEmojiUrl(id, animated) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=128`;
}

/** Descobre se um ID solto é de emoji animado — só o CDN sabe. */
async function probeAnimated(id) {
  try {
    const res = await fetch(cdnEmojiUrl(id, true), {
      method: 'HEAD',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Descobre a origem da imagem a partir do que o usuário passou.
 *
 * @param {{input?: string|null, attachment?: import('discord.js').Attachment|null}} options
 * @returns {Promise<{ok: true, url: string, name: string} | {ok: false, error: string}>}
 */
async function resolveEmojiSource({ input, attachment }) {
  if (attachment) {
    const type = String(attachment.contentType ?? '').toLowerCase();
    if (!type.startsWith('image/')) {
      return { ok: false, error: 'O arquivo precisa ser uma imagem (`png`, `jpg`, `gif` ou `webp`).' };
    }
    return { ok: true, url: attachment.url, name: sanitizeEmojiName(attachment.name?.replace(/\.[^.]+$/, '')) };
  }

  const raw = String(input ?? '').trim();
  if (!raw) {
    return { ok: false, error: 'Diga qual emoji adicionar: cole o emoji, o ID dele, um link ou anexe uma imagem.' };
  }

  const custom = parseCustomEmoji(raw);
  if (custom) {
    return { ok: true, url: cdnEmojiUrl(custom.id, custom.animated), name: sanitizeEmojiName(custom.name) };
  }

  if (/^\d{17,21}$/.test(raw)) {
    const animated = await probeAnimated(raw);
    return { ok: true, url: cdnEmojiUrl(raw, animated), name: `emoji_${raw.slice(-6)}` };
  }

  if (/^https?:/i.test(raw)) {
    const checked = checkPublicUrl(raw);
    if (!checked.ok) return checked;
    const fileName = checked.url.pathname.split('/').pop()?.replace(/\.[^.]+$/, '');
    return { ok: true, url: checked.url.toString(), name: sanitizeEmojiName(fileName) };
  }

  return {
    ok: false,
    error:
      'Não reconheci isso como emoji. Cole o emoji de outro servidor (ex: `<:nome:123456789012345678>`), ' +
      'o ID dele, ou um link `https://` da imagem.',
  };
}

/**
 * Baixa a imagem validando destino, tipo e tamanho em cada redirecionamento.
 *
 * @returns {Promise<{ok: true, bytes: Buffer} | {ok: false, error: string}>}
 */
async function fetchEmojiImage(url) {
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
      return { ok: false, error: `Não consegui baixar a imagem (${err.name === 'TimeoutError' ? 'tempo esgotado' : err.message}).` };
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
        error:
          res.status === 404
            ? 'Imagem não encontrada. Se você colou um ID, confira se o emoji ainda existe.'
            : `O servidor da imagem respondeu ${res.status}.`,
      };
    }

    const type = String(res.headers.get('content-type') ?? '').toLowerCase();
    if (!type.startsWith('image/')) return { ok: false, error: 'Esse link não aponta para uma imagem.' };

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_EMOJI_BYTES) {
      return { ok: false, error: `A imagem tem ${Math.round(declared / 1024)} KB. O limite do Discord é 256 KB.` };
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_EMOJI_BYTES) {
      return { ok: false, error: `A imagem tem ${Math.round(bytes.length / 1024)} KB. O limite do Discord é 256 KB.` };
    }

    return { ok: true, bytes };
  }

  return { ok: false, error: 'O link redirecionou vezes demais.' };
}

module.exports = {
  MAX_EMOJI_BYTES,
  checkPublicUrl,
  sanitizeEmojiName,
  cdnEmojiUrl,
  resolveEmojiSource,
  fetchEmojiImage,
};
