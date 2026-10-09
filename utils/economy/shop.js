// @ts-check
/** @type {readonly import('./types').ShopItem[]} */
const ITEMS = Object.freeze([
  { id: 'cafe', name: 'Café', emojiKey: 'eco_cafe', price: 150, type: 'consumable' },
  { id: 'pizza', name: 'Pizza', emojiKey: 'eco_pizza', price: 350, type: 'consumable' },
  { id: 'bala', name: 'Saco de Balas', emojiKey: 'eco_candy', price: 75, type: 'consumable' },
  { id: 'chocolate', name: 'Chocolate', emojiKey: 'eco_chocolate', price: 120, type: 'consumable' },
  { id: 'livro', name: 'Livro Antigo', emojiKey: 'eco_book', price: 650, type: 'collectible' },
  { id: 'planta', name: 'Planta Rara', emojiKey: 'eco_garden', price: 900, type: 'collectible' },
  { id: 'caixa', name: 'Caixa Misteriosa', emojiKey: 'eco_box', price: 1500, type: 'collectible' },
  { id: 'camera', name: 'Câmera', emojiKey: 'eco_camera', price: 1800, type: 'collectible' },
  { id: 'fone', name: 'Fone Gamer', emojiKey: 'eco_stream', price: 2200, type: 'collectible' },
  { id: 'anel', name: 'Anel de Prata', emojiKey: 'eco_ring', price: 4200, type: 'collectible' },
  { id: 'trofeu', name: 'Troféu Dourado', emojiKey: 'eco_crown', price: 7500, type: 'collectible' },
  { id: 'coroa', name: 'Coroa', emojiKey: 'eco_crown', price: 10000, type: 'collectible' },
  { id: 'reliquia', name: 'Relíquia Misteriosa', emojiKey: 'eco_relic', price: 15000, type: 'collectible' },
]);
module.exports = { ITEMS };
