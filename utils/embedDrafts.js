/**
 * Armazenamento em memória dos rascunhos de embed do /embed.
 *
 * O rascunho existe apenas entre a execução do comando e o clique em
 * Enviar/Excluir, então não vale persistir em banco. Cada rascunho expira
 * sozinho para não vazar memória se o autor abandonar o preview.
 */

const { randomBytes } = require('crypto');

const TTL_MS = 15 * 60 * 1000; // 15 minutos

/** @type {Map<string, { draft: object, timer: NodeJS.Timeout }>} */
const drafts = new Map();

function scheduleExpiry(id) {
  const timer = setTimeout(() => drafts.delete(id), TTL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * Guarda um novo rascunho e devolve o id gerado.
 * @param {object} data campos do rascunho (não é mutado).
 * @returns {string} id usado nos customId dos botões.
 */
function createDraft(data) {
  const id = randomBytes(8).toString('hex');
  drafts.set(id, { draft: { ...data, id }, timer: scheduleExpiry(id) });
  return id;
}

/** @returns {object|null} o rascunho, ou null se expirou/não existe. */
function getDraft(id) {
  return drafts.get(id)?.draft ?? null;
}

/**
 * Aplica alterações criando uma nova cópia do rascunho (sem mutação).
 * @returns {object|null} o rascunho atualizado, ou null se expirou.
 */
function updateDraft(id, changes) {
  const entry = drafts.get(id);
  if (!entry) return null;

  clearTimeout(entry.timer);
  const updated = { ...entry.draft, ...changes, id };
  drafts.set(id, { draft: updated, timer: scheduleExpiry(id) });
  return updated;
}

/** Remove o rascunho e cancela o timer de expiração. */
function deleteDraft(id) {
  const entry = drafts.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  drafts.delete(id);
  return true;
}

module.exports = { TTL_MS, createDraft, getDraft, updateDraft, deleteDraft };
