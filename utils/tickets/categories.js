// @ts-check
/**
 * Acesso à tabela `ticket_categories`.
 *
 * Fica aqui porque as telas do painel (leitura) e as ações do painel (escrita)
 * moram em módulos diferentes, e statements preparados em duplicado nos dois
 * seriam duas verdades sobre a mesma tabela.
 */

const { db } = require('../../database/db');

const stmts = {
  list: db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY id'),
  byId: db.prepare('SELECT * FROM ticket_categories WHERE id = ? AND guild_id = ?'),
  insert: db.prepare(
    'INSERT INTO ticket_categories (guild_id, label, emoji, target_category_id, support_role_id) VALUES (?, ?, ?, ?, ?)'
  ),
  updateMeta: db.prepare('UPDATE ticket_categories SET label = ?, emoji = ? WHERE id = ? AND guild_id = ?'),
  updateParent: db.prepare('UPDATE ticket_categories SET target_category_id = ? WHERE id = ? AND guild_id = ?'),
  updateRole: db.prepare('UPDATE ticket_categories SET support_role_id = ? WHERE id = ? AND guild_id = ?'),
  remove: db.prepare('DELETE FROM ticket_categories WHERE id = ? AND guild_id = ?'),
};

const listCategories = (guildId) => stmts.list.all(guildId);
const getCategory = (id, guildId) => stmts.byId.get(Number(id), guildId);

/** @returns {number|bigint} id da categoria criada */
const createCategory = (guildId, label, categoryEmoji) =>
  stmts.insert.run(guildId, label, categoryEmoji, null, null).lastInsertRowid;

/** @returns {boolean} false quando a categoria já não existe */
const renameCategory = (id, guildId, label, categoryEmoji) =>
  stmts.updateMeta.run(label, categoryEmoji, Number(id), guildId).changes > 0;

const setCategoryParent = (id, guildId, parentId) => stmts.updateParent.run(parentId, Number(id), guildId);
const setCategoryRole = (id, guildId, roleId) => stmts.updateRole.run(roleId, Number(id), guildId);
const deleteCategory = (id, guildId) => stmts.remove.run(Number(id), guildId);

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  renameCategory,
  setCategoryParent,
  setCategoryRole,
  deleteCategory,
};
