// @ts-check
/** @param {number} amount */
const formatMoney = (amount) => amount.toLocaleString('pt-BR');
/** @param {number} milliseconds */
function formatWait(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours && `${hours}h`, minutes && `${minutes}min`, `${seconds % 60}s`].filter(Boolean).join(' ');
}
module.exports = { formatMoney, formatWait };
