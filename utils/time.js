/**
 * Converte um timestamp do SQLite ('YYYY-MM-DD HH:MM:SS', sempre UTC) em Date.
 * Retorna null para valores ausentes ou inválidos.
 */
function parseSqlDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formata uma duração em milissegundos como "2d 3h 15m" (2 unidades mais significativas). */
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';

  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const units = [
    { label: 'd', seconds: 86400 },
    { label: 'h', seconds: 3600 },
    { label: 'm', seconds: 60 },
  ];

  const parts = [];
  let remaining = totalSeconds;
  for (const unit of units) {
    const value = Math.floor(remaining / unit.seconds);
    remaining %= unit.seconds;
    if (value > 0) parts.push(`${value}${unit.label}`);
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

/** Diferença em ms entre dois timestamps do SQLite. null se algum estiver ausente. */
function durationBetween(fromSql, toSql) {
  const from = parseSqlDate(fromSql);
  const to = parseSqlDate(toSql);
  if (!from || !to) return null;
  return to.getTime() - from.getTime();
}

module.exports = { parseSqlDate, formatDuration, durationBetween };
