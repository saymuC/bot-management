/**
 * Presença (status) do bot.
 *
 * É uma configuração global — não por servidor — então mora em `bot_settings`
 * e é reaplicada no ready, senão o status voltaria ao padrão a cada restart.
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
  none: { label: 'Nenhuma (sem atividade)', type: null, prefix: '' },
  custom: { label: 'Personalizado (só o texto)', type: ActivityType.Custom, prefix: '' },
  playing: { label: 'Jogando', type: ActivityType.Playing, prefix: 'Jogando' },
  watching: { label: 'Assistindo', type: ActivityType.Watching, prefix: 'Assistindo' },
  listening: { label: 'Ouvindo', type: ActivityType.Listening, prefix: 'Ouvindo' },
  competing: { label: 'Competindo em', type: ActivityType.Competing, prefix: 'Competindo em' },
  streaming: { label: 'Transmitindo (precisa de URL)', type: ActivityType.Streaming, prefix: 'Transmitindo' },
});

const DEFAULT_PRESENCE = Object.freeze({
  status: 'online',
  activity: 'watching',
  text: 'o servidor 👀',
  url: null,
});

/** Mescla o JSON salvo com os defaults, descartando valores desconhecidos. */
function normalizePresence(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    status: Object.hasOwn(STATUSES, source.status) ? source.status : DEFAULT_PRESENCE.status,
    activity: Object.hasOwn(ACTIVITIES, source.activity) ? source.activity : DEFAULT_PRESENCE.activity,
    text: typeof source.text === 'string' ? source.text.slice(0, 128) : DEFAULT_PRESENCE.text,
    url: isHttpUrl(source.url) ? source.url : null,
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
 * `Custom` exige `state` (o `name` é ignorado pelo Discord nesse tipo) e
 * `Streaming` só mostra o ícone roxo quando acompanhado de uma URL válida.
 */
function applyPresence(client, presence) {
  const config = normalizePresence(presence);
  const meta = ACTIVITIES[config.activity];

  const activities = [];
  if (meta.type !== null && config.text) {
    const activity = { name: config.text, type: meta.type };
    if (meta.type === ActivityType.Custom) activity.state = config.text;
    if (meta.type === ActivityType.Streaming && config.url) activity.url = config.url;
    activities.push(activity);
  }

  client.user.setPresence({ status: config.status, activities });
  return config;
}

/** Resumo legível para exibir na resposta do comando. */
function describePresence(config) {
  const meta = ACTIVITIES[config.activity];
  if (meta.type === null || !config.text) return `${STATUSES[config.status].label} · sem atividade`;
  const prefix = meta.prefix ? `${meta.prefix} ` : '';
  const streaming = config.activity === 'streaming' && config.url ? ` (${config.url})` : '';
  return `${STATUSES[config.status].label} · **${prefix}${config.text}**${streaming}`;
}

module.exports = {
  STATUSES,
  ACTIVITIES,
  DEFAULT_PRESENCE,
  normalizePresence,
  getSavedPresence,
  savePresence,
  applyPresence,
  describePresence,
};
