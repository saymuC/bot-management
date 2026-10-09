// @ts-check
/** @type {readonly {name: string, emojiKey: keyof typeof import('../emojis').REGISTRY, messages: string[]}[]} */
const JOBS = Object.freeze([
  { name: 'Atendente', emojiKey: 'eco_burger', messages: ['Você achou o pedido perdido. Estava embaixo do balcão.', 'Serviu o cliente mais exigente da fila. Ele pediu mais guardanapos.'] },
  { name: 'Motorista', emojiKey: 'eco_taxi', messages: ['Você encontrou uma rota sem trânsito. O GPS ficou confuso.', 'Levou um passageiro até o destino. Ele elogiou sua playlist.'] },
  { name: 'Desenvolvedor', emojiKey: 'eco_dev', messages: ['O bug desapareceu depois que você adicionou um console.log. Ninguém sabe por quê.', 'Reiniciou o servidor e misteriosamente tudo voltou a funcionar.'] },
  { name: 'Designer', emojiKey: 'eco_design', messages: ['Moveu um botão 2 pixels para a esquerda. O cliente disse que agora está perfeito.', 'Criou uma paleta nova. O cliente escolheu a primeira versão.'] },
  { name: 'Streamer', emojiKey: 'eco_stream', messages: ['Esqueceu o microfone mutado por dez minutos. O chat adorou.', 'Bateu recorde de espectadores. Sua mãe estava assistindo em cinco telas.'] },
  { name: 'Entregador', emojiKey: 'eco_delivery', messages: ['A encomenda chegou inteira. Surpreendentemente.', 'Encontrou o endereço sem ajuda do GPS. O porteiro ficou impressionado.'] },
  { name: 'Faxineiro', emojiKey: 'eco_clean', messages: ['Limpou o servidor. Alguém já derrubou café de novo.', 'Deixou o escritório brilhando. Seu reflexo no chão te assustou.'] },
  { name: 'Cozinheiro', emojiKey: 'eco_chef', messages: ['Inventou uma receita. Ninguém perguntou os ingredientes.', 'Preparou o prato do dia. Até o chef pediu a receita.'] },
  { name: 'Jardineiro', emojiKey: 'eco_garden', messages: ['Podou as árvores da praça. Um esquilo supervisionou tudo.', 'Salvou uma planta esquecida. Agora ela tem nome e fã-clube.'] },
  { name: 'Fotógrafo', emojiKey: 'eco_camera', messages: ['Fotografou um casamento. O cachorro saiu melhor que os noivos.', 'Capturou o pôr do sol perfeito. Ninguém acreditou que era sem filtro.'] },
  { name: 'Barista', emojiKey: 'eco_cafe', messages: ['Desenhou um coração no café. O cliente pediu outro para postar.', 'Acertou a temperatura do espresso. A fila aplaudiu.'] },
  { name: 'Mecânico', emojiKey: 'eco_taxi', messages: ['Consertou um motor barulhento. O dono achou que o carro tinha morrido.', 'Achou o parafuso perdido. Estava no seu bolso o tempo todo.'] },
]);
module.exports = { JOBS };
