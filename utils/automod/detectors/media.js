/**
 * Detector da família "mídia e anexos".
 *
 * O caso de uso é o canal de texto puro: nenhuma imagem, nenhum gif, nenhum
 * vídeo — e o canal de memes liberado nas isenções da regra. Por isso a regra
 * olha os **dois** caminhos pelos quais mídia entra num canal: o anexo e o link
 * direto para o arquivo. Barrar só o anexo seria um filtro que qualquer pessoa
 * contorna colando a URL da imagem.
 *
 * A classificação usa o `contentType` que o Discord manda e cai na extensão do
 * nome quando ele vem nulo (acontece com upload de cliente antigo e com alguns
 * proxies). Áudio entra em "outros arquivos" de propósito: o modal do Discord
 * aceita 5 campos por regra, e separar áudio custaria a figurinha.
 */

/** Extensões por categoria. Gif é separado de imagem porque o uso é outro. */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'svg', 'ico']);
const GIF_EXT = new Set(['gif', 'apng', 'gifv']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mpeg', 'mpg']);

/** Hosts cujo link **é** um gif, mesmo sem extensão no caminho. */
const GIF_HOSTS = ['tenor.com', 'giphy.com', 'gph.is', 'gfycat.com', 'redgifs.com'];

/** Como cada categoria aparece no log e no aviso ao infrator. */
const KIND_LABELS = Object.freeze({
  images: 'imagem',
  gifs: 'gif',
  videos: 'vídeo',
  files: 'arquivo',
});

/** Extensão de um nome ou caminho, sem ponto, sem query e em minúsculas. */
function extensionOfPath(value) {
  const clean = String(value ?? '')
    .trim()
    .split(/[?#]/)[0];
  const match = /\.([a-z0-9]{1,12})$/i.exec(clean);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Categoria de um anexo: `images`, `gifs`, `videos` ou `files`.
 *
 * `files` é o destino de tudo o que não é imagem, gif nem vídeo — inclusive do
 * anexo que o bot não conseguiu identificar. Cair no catch-all é o desfecho
 * seguro: quem ligou "barrar outros arquivos" quis dizer "nada além de texto".
 */
function classifyAttachment({ name, contentType } = {}) {
  const mime = String(contentType ?? '').toLowerCase();

  if (mime.startsWith('image/')) return mime === 'image/gif' || mime === 'image/apng' ? 'gifs' : 'images';
  if (mime.startsWith('video/')) return 'videos';

  const ext = extensionOfPath(name);
  if (GIF_EXT.has(ext)) return 'gifs';
  if (IMAGE_EXT.has(ext)) return 'images';
  if (VIDEO_EXT.has(ext)) return 'videos';

  return 'files';
}

/**
 * Links de mídia no texto: `{ kind, host }` do primeiro que a regra barra.
 *
 * Exige host **e** caminho (`site.com/foto.png`) para reconhecer pela extensão.
 * Sem essa exigência, "manda o arquivo.png" numa frase viraria link de imagem —
 * e o filtro que pune conversa sobre arquivo é pior do que o filtro que deixa
 * passar uma URL exótica.
 */
function findMediaLink(content, limits) {
  const text = String(content ?? '');

  if (limits.gifs) {
    for (const host of GIF_HOSTS) {
      const escaped = host.replace(/\./g, '\\.');
      if (new RegExp(`(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*${escaped}/`, 'i').test(text)) {
        return { kind: 'gifs', host };
      }
    }
  }

  for (const match of text.matchAll(/(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(\S*)/gi)) {
    const kind = classifyAttachment({ name: match[2] });
    // `files` aqui seria qualquer link com caminho — isto é trabalho da regra
    // "Links em geral", não desta.
    if (kind !== 'files' && limits[kind]) return { kind, host: match[1].toLowerCase().replace(/^www\./, '') };
  }

  return null;
}

const detectors = {
  /**
   * O `detail` cita a categoria e a extensão, nunca o nome do arquivo: o nome é
   * texto que o infrator escolheu e ele vai para o log e para o aviso público,
   * onde markdown alheio não tem o que fazer.
   */
  media({ attachmentFiles, stickers, content }, limits) {
    for (const file of attachmentFiles ?? []) {
      const kind = classifyAttachment(file);
      if (!limits[kind]) continue;

      const ext = extensionOfPath(file?.name);
      // "em anexo" e não "anexada"/"anexado": o rótulo muda de gênero (imagem,
      // gif, vídeo, arquivo) e a frase precisa servir para os quatro.
      return { detail: `${KIND_LABELS[kind]} em anexo${ext ? ` (.${ext})` : ''}` };
    }

    if (limits.stickers && stickers > 0) return { detail: 'figurinha' };

    const link = findMediaLink(content, limits);
    if (link) return { detail: `link de ${KIND_LABELS[link.kind]}: ${link.host}` };

    return null;
  },
};

module.exports = {
  IMAGE_EXT,
  GIF_EXT,
  VIDEO_EXT,
  GIF_HOSTS,
  KIND_LABELS,
  detectors,
  extensionOfPath,
  classifyAttachment,
  findMediaLink,
};
