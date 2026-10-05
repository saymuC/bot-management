// @ts-check
/** @type {readonly import('./types').ShopItem[]} */
const ITEMS = Object.freeze([
  { id: 'cafe', name: 'Café', emojiKey: 'eco_cafe', price: 150, type: 'consumable' },
  { id: 'pizza', name: 'Pizza', emojiKey: 'eco_pizza', price: 350, type: 'consumable' },
  { id: 'caixa', name: 'Caixa Misteriosa', emojiKey: 'eco_box', price: 1500, type: 'collectible' },
  { id: 'coroa', name: 'Coroa', emojiKey: 'eco_crown', price: 10000, type: 'collectible' },
]);
module.exports = { ITEMS };
