const { AttachmentBuilder } = require('discord.js');

const MAX_MESSAGES = 500;
const PAGE_SIZE = 100;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para inserção segura em HTML — todo conteúdo vem de usuários. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Busca o histórico do canal em ordem cronológica, paginando pelo limite de 100
 * mensagens por request da API do Discord.
 */
async function fetchChannelHistory(channel, max = MAX_MESSAGES) {
  const collected = [];
  let before;

  while (collected.length < max) {
    const batch = await channel.messages.fetch({
      limit: Math.min(PAGE_SIZE, max - collected.length),
      ...(before ? { before } : {}),
    });
    if (batch.size === 0) break;

    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < PAGE_SIZE) break;
  }

  return collected.reverse();
}

/** Renderiza uma mensagem como bloco HTML. */
function renderMessage(message) {
  const timestamp = message.createdAt.toISOString().replace('T', ' ').slice(0, 19);
  const avatar = message.author.displayAvatarURL({ extension: 'png', size: 64 });

  const blocks = [];
  if (message.content) {
    blocks.push(`<div class="content">${escapeHtml(message.content).replaceAll('\n', '<br>')}</div>`);
  }

  for (const embed of message.embeds) {
    const parts = [
      embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : '',
      embed.description ? `<div>${escapeHtml(embed.description).replaceAll('\n', '<br>')}</div>` : '',
      ...embed.fields.map(
        (f) => `<div class="embed-field"><b>${escapeHtml(f.name)}</b><br>${escapeHtml(f.value)}</div>`
      ),
    ].filter(Boolean);
    const color = typeof embed.color === 'number' ? `#${embed.color.toString(16).padStart(6, '0')}` : '#4f545c';
    blocks.push(`<div class="embed" style="border-left-color:${color}">${parts.join('')}</div>`);
  }

  for (const attachment of message.attachments.values()) {
    blocks.push(
      `<div class="attachment">📎 <a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener">${escapeHtml(attachment.name)}</a></div>`
    );
  }

  if (!blocks.length) blocks.push('<div class="content empty">[mensagem sem conteúdo textual]</div>');

  return `<div class="msg">
  <img class="avatar" src="${escapeHtml(avatar)}" alt="">
  <div class="body">
    <div class="meta"><span class="author">${escapeHtml(message.author.tag)}</span><span class="time">${escapeHtml(timestamp)}</span></div>
    ${blocks.join('\n    ')}
  </div>
</div>`;
}

const STYLES = `
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #313338; color: #dbdee1;
         font-family: "gg sans", "Segoe UI", Helvetica, Arial, sans-serif; font-size: 15px; }
  .wrap { max-width: 860px; margin: 0 auto; }
  header { border-bottom: 1px solid #3f4147; padding-bottom: 16px; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 12px; color: #f2f3f5; }
  .info { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px 24px; font-size: 14px; }
  .info div span { color: #949ba4; }
  .msg { display: flex; gap: 14px; padding: 8px 0; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; background: #232428; }
  .body { min-width: 0; flex: 1; }
  .meta { margin-bottom: 2px; }
  .author { font-weight: 600; color: #f2f3f5; }
  .time { color: #949ba4; font-size: 12px; margin-left: 8px; }
  .content { white-space: pre-wrap; word-wrap: break-word; }
  .content.empty { color: #949ba4; font-style: italic; }
  .embed { border-left: 4px solid #4f545c; background: #2b2d31; border-radius: 4px; padding: 10px 12px; margin-top: 6px; }
  .embed-title { font-weight: 600; color: #f2f3f5; margin-bottom: 4px; }
  .embed-field { margin-top: 8px; font-size: 14px; }
  .attachment { margin-top: 6px; font-size: 14px; }
  a { color: #00a8fc; }
  footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #3f4147; color: #949ba4; font-size: 12px; }
`;

/**
 * Gera o transcript HTML do ticket como anexo pronto para envio.
 * @param {object} params
 * @param {object} params.ticket linha da tabela tickets
 * @param {Array}  params.messages mensagens em ordem cronológica
 * @param {object} params.details pares rótulo/valor exibidos no cabeçalho
 */
function buildHtmlTranscript({ ticket, messages, details = {} }) {
  const header = Object.entries(details)
    .map(([label, value]) => `<div><span>${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>`)
    .join('\n      ');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket #${ticket.id} — Transcript</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>🎫 Ticket #${ticket.id} — ${escapeHtml(ticket.category_label ?? 'Sem categoria')}</h1>
    <div class="info">
      ${header}
    </div>
  </header>
  ${messages.map(renderMessage).join('\n  ')}
  <footer>${messages.length} mensagem(ns) arquivada(s). Gerado em ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC.</footer>
</div>
</body>
</html>`;

  return new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `ticket-${ticket.id}-transcript.html` });
}

module.exports = { fetchChannelHistory, buildHtmlTranscript, escapeHtml };
