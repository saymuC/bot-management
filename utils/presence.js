/**
 * Presença (status) do bot.
 *
 * É uma configuração global — não por servidor — então mora em `bot_settings`
 * e é reaplicada no ready, senão o status voltaria ao padrão a cada restart.
 *
 * Limite da API (docs do Discord, Activity Object): contas de bot só podem
 * enviar `name`, `state`, `type` e `url`. Botões de Rich Presence, imagens
 * (`assets`) e `details` são ignorados para bots — por isso não existem aqui.
 */

const { ActivityType } = require('discord.js');
const { getBotSetting, setBotSetting } = require('../database/db');
const { isHttpUrl } = require('./media');

const SETTING_KEY = 'presence';

/** Status de disponibilidade aceitos pelo gateway. */
const STATUSES = Object.freeze({
  online: { label: '🟢 Online', value: 'online' },
  idle: { label: '🌙 Ausente', value: 'idle' },
  dnd: { label: '⛔ Não perturbe', value: 'dnd' },
  invisible: { label: '⚫ Invisível', value: 'invisible' },
});

/** Tipos de atividade + como cada um aparece no perfil do bot. */
const ACTIVITIES = Object.freeze({
  none: { label: 'Nenhuma (sem atividade)', emoji: '🚫', type: null, prefix: '', hint: 'O bot fica só com a bolinha de status.' },
  custom: {
    label: 'Personalizado',
    emoji: '💬',
    type: ActivityType.Custom,
    prefix: '',
    hint: 'Mostra apenas o texto, sem "Jogando/Assistindo".',
  },
  playing: { label: 'Jogando', emoji: '🎮', type: ActivityType.Playing, prefix: 'Jogando', hint: 'Jogando <nome>' },
  watching: { label: 'Assistindo', emoji: '📺', type: ActivityType.Watching, prefix: 'Assistindo', hint: 'Assistindo <nome>' },
  listening: { label: 'Ouvindo', emoji: '🎧', type: ActivityType.Listening, prefix: 'Ouvindo', hint: 'Ouvindo <nome>' },
  competing: {
    label: 'Competindo em',
    emoji: '🏆',
    type: ActivityType.Competing,
    prefix: 'Competindo em',
    hint: 'Competindo em <nome>',
  },
  streaming: {
    label: 'Transmitindo (título clicável)',
    emoji: '🔴',
    type: ActivityType.Streaming,
    prefix: 'Transmitindo',
    hint: 'Único tipo em que o título vira link. Só Twitch e YouTube.',
  },
});

/** Hosts que o Discord aceita no `url` do tipo Transmitindo. */
const STREAM_HOSTS = Object.freeze(['twitch.tv', 'www.twitch.tv', 'youtube.com', 'www.youtube.com', 'm.youtube.com']);

const DEFAULT_PRESENCE = Object.freeze({
  status: 'online',
  activity: 'watching',
  name: 'o servidor 👀',
  state: '',
  url: null,
});

/** True quando a URL é aceita pelo Discord como stream (Twitch/YouTube). */
function isStreamUrl(raw) {
  if (!isHttpUrl(raw)) return false;
  try {
    return STREAM_HOSTS.includes(new URL(String(raw).trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' ? value.slice(0, 128) : fallback;
}

/** Mescla o objeto recebido com os defaults, descartando valores desconhecidos. */
function normalizePresence(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    status: Object.hasOwn(STATUSES, source.status) ? source.status : DEFAULT_PRESENCE.status,
    activity: Object.hasOwn(ACTIVITIES, source.activity) ? source.activity : DEFAULT_PRESENCE.activity,
    // `text` era o nome do campo na primeira versão do comando.
    name: cleanText(source.name ?? source.text, DEFAULT_PRESENCE.name),
    state: cleanText(source.state, DEFAULT_PRESENCE.state),
    url: isHttpUrl(source.url) ? String(source.url).trim() : null,
  };
}

/** @returns {ReturnType<typeof normalizePresence>} presença salva ou o padrão. */
function getSavedPresence() {
  const stored = getBotSetting(SETTING_KEY);
  if (!stored) return normalizePresence(DEFAULT_PRESENCE);
  try {
    return normalizePresence(JSON.parse(stored));
  } catch (err) {
    console.error('[presence] JSON inválido no banco, usando padrão:', err.message);
    return normalizePresence(DEFAULT_PRESENCE);
  }
}

function savePresence(presence) {
  const normalized = normalizePresence(presence);
  setBotSetting(SETTING_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * Aplica a presença no client.
 *
 * No tipo `Custom` o Discord ignora o `name` e exibe o `state`, então caímos
 * para o nome quando a linha extra está vazia. `Streaming` só mostra o título
 * como link quando acompanhado de uma URL de Twitch/YouTube.
 */
function applyPresence(client, presence) {
  const config = normalizePresence(presence);
  const meta = ACTIVITIES[config.activity];
  const activities = [];

  const isCustom = meta.type === ActivityType.Custom;
  const label = isCustom ? config.state || config.name : config.name;

  if (meta.type !== null && label) {
    const activity = { name: label, type: meta.type };
    if (isCustom) activity.state = label;
    else if (config.state) activity.state = config.state;
    if (meta.type === ActivityType.Streaming && isStreamUrl(config.url)) activity.url = config.url;
    activities.push(activity);
  }

  client.user.setPresence({ status: config.status, activities });
  return config;
}

/** Resumo de uma linha, usado no log do boot e nas confirmações. */
function describePresence(config) {
  const normalized = normalizePresence(config);
  const meta = ACTIVITIES[normalized.activity];
  const isCustom = meta.type === ActivityType.Custom;
  const label = isCustom ? normalized.state || normalized.name : normalized.name;

  if (meta.type === null || !label) return `${STATUSES[normalized.status].label} · sem atividade`;

  const prefix = meta.prefix ? `${meta.prefix} ` : '';
  const extra = !isCustom && normalized.state ? ` — ${normalized.state}` : '';
  const link = normalized.activity === 'streaming' && isStreamUrl(normalized.url) ? ` 🔗 <${normalized.url}>` : '';
  return `${STATUSES[normalized.status].label} · **${prefix}${label}**${extra}${link}`;
}

/** Avisos sobre combinações que não vão renderizar como o usuário espera. */
function presenceWarnings(config) {
  const normalized = normalizePresence(config);
  const warnings = [];
  const isCustom = ACTIVITIES[normalized.activity].type === ActivityType.Custom;

  if (normalized.activity !== 'none' && !(isCustom ? normalized.state || normalized.name : normalized.name)) {
    warnings.push('Sem texto o bot fica **sem atividade nenhuma** — preencha o nome em “Textos”.');
  }
  if (normalized.activity === 'streaming' && !isStreamUrl(normalized.url)) {
    warnings.push('`Transmitindo` sem URL de **Twitch/YouTube** não vira link clicável.');
  }
  if (normalized.activity !== 'streaming' && normalized.url) {
    warnings.push('O link só é usado no tipo `Transmitindo`; nos outros o Discord o ignora.');
  }
  return warnings;
}

module.exports = {
  STATUSES,
  ACTIVITIES,
  STREAM_HOSTS,
  DEFAULT_PRESENCE,
  isStreamUrl,
  normalizePresence,
  getSavedPresence,
  savePresence,
  applyPresence,
  describePresence,
  presenceWarnings,
};
