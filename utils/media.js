/**
 * Classificação de mídia para embeds.
 *
 * Embeds do Discord só renderizam imagens (incluindo GIF) no campo `image`.
 * Vídeos não entram no embed: precisam ser enviados como anexo da mensagem
 * (arquivo) ou como link no conteúdo, para o Discord gerar o player.
 */

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv'];

/** Remove caracteres problemáticos e garante um nome de arquivo utilizável. */
function sanitizeFileName(name, fallback = 'anexo') {
  const clean = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.-]/g, '_')
    .slice(-100);
  return clean.replace(/^[._-]+/, '') || fallback;
}

/** Extensão em minúsculas de um nome de arquivo ou caminho de URL. */
function extensionOf(value) {
  const match = /\.([a-zA-Z0-9]{2,5})$/.exec(String(value ?? '').split('?')[0]);
  return match ? match[1].toLowerCase() : null;
}

/** @returns {boolean} true para http(s) válido. */
function isHttpUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Classifica um anexo do Discord.
 * @returns {{ kind: 'image'|'video'|'file', url: string, name: string }}
 */
function classifyAttachment(attachment) {
  const name = sanitizeFileName(attachment.name, 'anexo');
  const contentType = String(attachment.contentType ?? '').toLowerCase();
  const ext = extensionOf(name);

  if (contentType.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) {
    return { kind: 'image', url: attachment.url, name };
  }
  if (contentType.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) {
    return { kind: 'video', url: attachment.url, name };
  }
  return { kind: 'file', url: attachment.url, name };
}

/**
 * Classifica um link de mídia.
 * @returns {{ kind: 'image'|'video'|'link', url: string }|null} null se não for URL válida.
 */
function classifyUrl(raw) {
  const url = String(raw ?? '').trim();
  if (!isHttpUrl(url)) return null;

  const ext = extensionOf(url);
  if (IMAGE_EXTENSIONS.includes(ext)) return { kind: 'image', url };
  if (VIDEO_EXTENSIONS.includes(ext)) return { kind: 'video', url };
  return { kind: 'link', url };
}

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  sanitizeFileName,
  extensionOf,
  isHttpUrl,
  classifyAttachment,
  classifyUrl,
};
