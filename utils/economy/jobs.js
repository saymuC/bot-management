// @ts-check
/** @type {readonly {name: string, emojiKey: keyof typeof import('../emojis').REGISTRY, messages: string[]}[]} */
const JOBS = Object.freeze([
  { name: 'Atendente', emojiKey: 'eco_burger', messages: ['Você achou o pedido perdido. Estava embaixo do balcão.'] },
  { name: 'Motorista', emojiKey: 'eco_taxi', messages: ['Você encontrou uma rota sem trânsito. O GPS ficou confuso.'] },
  { name: 'Desenvolvedor', emojiKey: 'eco_dev', messages: ['O bug desapareceu depois que você adicionou um console.log. Ninguém sabe por quê.', 'Reiniciou o servidor e misteriosamente tudo voltou a funcionar.'] },
  { name: 'Designer', emojiKey: 'eco_design', messages: ['Moveu um botão 2 pixels para a esquerda. O cliente disse que agora está perfeito.'] },
  { name: 'Streamer', emojiKey: 'eco_stream', messages: ['Esqueceu o microfone mutado por dez minutos. O chat adorou.'] },
  { name: 'Entregador', emojiKey: 'eco_delivery', messages: ['A encomenda chegou inteira. Surpreendentemente.'] },
  { name: 'Faxineiro', emojiKey: 'eco_clean', messages: ['Limpou o servidor. Alguém já derrubou café de novo.'] },
  { name: 'Cozinheiro', emojiKey: 'eco_chef', messages: ['Inventou uma receita. Ninguém perguntou os ingredientes.'] },
]);
module.exports = { JOBS };
