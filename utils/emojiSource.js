/**
 * Resolve de onde vem a imagem de um emoji novo (para o /emoji-add).
 *
 * Aceita três origens: um emoji personalizado colado no comando, o ID cru dele
 * ou um link de imagem. A imagem é baixada aqui — e não entregue como URL ao
 * discord.js — para o comando poder recusar arquivo grande demais com uma
 * mensagem clara em vez de deixar a API devolver um erro genérico.
 */

const { parseCustomEmoji } = require('./emojis');
const { checkPublicUrl, fetchRemoteImage, REQUEST_TIMEOUT_MS } = require('./remoteImage');

/** Limite do Discord para imagem de emoji. */
const MAX_EMOJI_BYTES = 256 * 1024;

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
 * Baixa a imagem do emoji com o limite e as mensagens do `/emoji-add`.
 *
 * A validação de destino e o passo a passo do redirecionamento estão em
 * `utils/remoteImage.js`; o que é específico do emoji são o teto de 256 KB e o
 * texto do 404, que fala do ID que a pessoa pode ter colado.
 *
 * @param {string} url
 * @returns {Promise<{ok: true, bytes: Buffer} | {ok: false, error: string}>}
 */
function fetchEmojiImage(url) {
  return fetchRemoteImage(url, {
    maxBytes: MAX_EMOJI_BYTES,
    tooLarge: (kb) => `A imagem tem ${kb} KB. O limite do Discord é 256 KB.`,
    notFound: 'Imagem não encontrada. Se você colou um ID, confira se o emoji ainda existe.',
  });
}

module.exports = {
  MAX_EMOJI_BYTES,
  checkPublicUrl,
  sanitizeEmojiName,
  cdnEmojiUrl,
  resolveEmojiSource,
  fetchEmojiImage,
};
