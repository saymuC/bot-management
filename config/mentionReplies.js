/**
 * Respostas do bot quando alguém o menciona.
 *
 * Arquivo pensado para ser editado à vontade: basta acrescentar strings nas
 * listas ou uma nova regra em KEYWORD_RULES. Placeholders disponíveis nos
 * textos: {user} (menção), {username} (apelido) e {server}.
 */

/** Respostas curtas em texto puro — o caso mais comum. */
const RANDOM_TEXTS = Object.freeze([
  'Oi {user}! 👋 Precisa de algo? Digite `/` que eu te mostro meus comandos.',
  'Presente! 🙋 Manda um `/` no chat pra ver o que eu sei fazer.',
  'Alguém me chamou? 👀',
  'Tô aqui, {username}. Só não me peça pra lavar louça. 🧽',
  'Fala {user}! Já dei uma olhada no servidor e tá tudo em ordem. ✅',
  'Pode falar, sou todo ouvidos... ou todo bytes. 🤖',
  'Zzz... 😴 ah, oi! Acordei agora.',
  'Bip bop 🤖 processando sua menção... concluído!',
  'Se eu tivesse um real por cada menção, já tinha comprado um servidor melhor. 💸',
  'Olá {user}! Fun fact: eu nunca durmo. Nem quando o host reinicia. 💤',
  'Cuidado, eu anoto tudo nos logs. 📝 Brincadeira... ou não.',
  'Fui feito de puro JavaScript e cafeína ☕ — como posso ajudar?',
  'Menção recebida com sucesso, status 200 OK. ✅',
  'Aqui é o bot mais bonito do **{server}**, muito prazer. 😎',
]);

/** De vez em quando a resposta vem num embed, pra variar o visual. */
const RANDOM_EMBEDS = Object.freeze([
  {
    title: '🤖 Alguém me chamou?',
    description: 'Sou o assistente do **{server}**.\nDigite `/` no chat para ver tudo o que eu faço.',
  },
  {
    title: '📊 Status do sistema',
    description: 'Humor: **ótimo**\nCafé: **infinito** ☕\nBugs conhecidos: **zero** (que eu admita)',
  },
  {
    title: '🔮 Bola de cristal',
    description: '{user}, vejo em seu futuro... um ticket sendo aberto. 🎫',
  },
  {
    title: '🏅 Menção do dia',
    description: 'Parabéns {user}, você acaba de ganhar exatamente **0 pontos**.\nMas foi com carinho. 💙',
  },
]);

/** Emojis que o bot pode usar pra reagir à mensagem. */
const REACTIONS = Object.freeze(['👀', '🤖', '👋', '💙', '✨', '🫡']);

/**
 * Regras por palavra-chave, avaliadas em ordem — a primeira que casar responde.
 * `build` recebe { message, client } e devolve string ou { title, description }.
 */
const KEYWORD_RULES = Object.freeze([
  {
    name: 'ping',
    pattern: /\bpings?\b|lat[êe]ncia/i,
    build: ({ client }) => `🏓 Pong! Latência do gateway: **${Math.max(client.ws.ping, 0)}ms**.`,
  },
  {
    name: 'ajuda',
    pattern: /\bajuda\b|\bhelp\b|\bcomandos?\b|como usar/i,
    build: () =>
      'Digite `/` no chat para ver a lista completa de comandos. 📚 Se travar em algo, abra um ticket no painel de atendimento do servidor.',
  },
  {
    name: 'saudacao',
    pattern: /\b(oi|ol[áa]|eae|e a[íi]|fala|hey|hello)\b/i,
    build: () => 'Oi {user}! Tudo certo por aí? 😄',
  },
  {
    name: 'bom-dia',
    pattern: /bom dia|boa tarde|boa noite/i,
    build: () => 'Igualmente, {user}! ☀️🌙 Que seu dia renderize sem lag.',
  },
  {
    name: 'agradecimento',
    pattern: /\b(obrigad[oa]|valeu|vlw|thanks|brigad[oa])\b/i,
    build: () => 'Por nada, {user}! 💙 É pra isso que eu tô aqui.',
  },
  {
    name: 'elogio',
    pattern: /\b(top|lindo|maneiro|melhor bot|incr[íi]vel|amo voc[êe]|te amo)\b/i,
    build: () => 'Awn, {user}... 🥹 agora meu uptime tem propósito.',
  },
  {
    name: 'ofensa',
    pattern: /\b(burro|lixo|ruim|bosta|in[úu]til|idiota)\b/i,
    build: () => 'Ai. 💔 Vou fingir que não li e seguir funcionando perfeitamente. 🤖',
  },
  {
    name: 'quem-e-voce',
    pattern: /quem (é|e) (voc[êe]|tu)|o que voc[êe] faz|pra que serve/i,
    build: ({ client }) => ({
      title: `🤖 Eu sou o ${client.user.username}`,
      description:
        'Cuido de tickets, sorteios, moderação, boas-vindas e cargos aqui no **{server}**.\nDigite `/` pra ver a lista inteira.',
    }),
  },
]);

module.exports = { RANDOM_TEXTS, RANDOM_EMBEDS, REACTIONS, KEYWORD_RULES };
