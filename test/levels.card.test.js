/**
 * Testes da imagem do ranking.
 *
 * O desenho em si não dá para afirmar em teste — nenhuma asserção razoável diz
 * "este PNG está bonito". O que dá, e é o que quebra na prática, são as partes
 * decidíveis: a altura calculada a partir do número de linhas, a assinatura que
 * invalida o cache, e o comportamento das duas redes envolvidas (avatar e fundo),
 * onde o contrato é "falha vira reserva, nunca exceção".
 *
 * O smoke de render é pulado em host sem fonte: lá o resultado correto é `null`, e
 * isso é a reserva funcionando, não um teste falhando.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');

const { checkCanvasFonts, fontStacks } = require('../utils/canvasFonts');
const { createCache } = require('../utils/levels/card/cache');
const { fitText } = require('../utils/levels/card/primitives');
const { TOP } = require('../utils/levels/card/theme');
const { cardHeight, pageSignature, pageCache, renderLeaderboardCard } =
  require('../utils/levels/card/leaderboardCard');
const { avatarCache, loadAvatar, loadAvatars } = require('../utils/levels/card/avatars');
const { backgroundCache, loadBackgroundImage } = require('../utils/levels/card/background');

const temFonte = checkCanvasFonts().ok;

/** Imagem de mentira: só o que `drawAvatar` e `paintBackground` leem. */
const imagemFalsa = (width = 64, height = 64) => ({ width, height });

const entradas = (quantidade, primeiraPosicao = 1) =>
  Array.from({ length: quantidade }, (_, index) => ({
    position: primeiraPosicao + index,
    id: String(100000000000000000n + BigInt(index)),
    name: `Membro ${index + 1}`,
    avatarUrl: null,
    totalXp: 10000 - index * 500,
  }));

// --- Cache -----------------------------------------------------------------

test('cache devolve o que guardou e esquece o que venceu', () => {
  const cache = createCache({ ttlMs: 1000, max: 4 });
  cache.set('a', 'valor', 0);

  assert.equal(cache.get('a', 500), 'valor');
  assert.equal(cache.get('a', 1000), undefined, 'no instante do vencimento já expirou');
  assert.equal(cache.size(), 0, 'a leitura vencida remove a entrada');
});

test('cache respeita o teto descartando o menos usado', () => {
  const cache = createCache({ ttlMs: 60_000, max: 3 });
  for (const key of ['a', 'b', 'c']) cache.set(key, key);

  cache.get('a'); // 'a' volta a ser recente; o próximo descarte tem de pegar 'b'
  cache.set('d', 'd');

  assert.equal(cache.size(), 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 'a');
  assert.equal(cache.get('d'), 'd');
});

test('cache guarda null como valor legítimo', () => {
  const cache = createCache({ ttlMs: 60_000, max: 2 });
  cache.set('x', null);

  assert.equal(cache.get('x'), null, 'null é "já tentei e não deu", não é "nunca tentei"');
  assert.equal(cache.size(), 1);
});

// --- Texto e geometria -----------------------------------------------------

test('fitText não mexe no que já cabe e corta o resto com reticências', { skip: !temFonte }, () => {
  const ctx = createCanvas(400, 100).getContext('2d');
  const families = fontStacks();
  ctx.font = `20px ${families.body}`;

  assert.equal(fitText(ctx, 'curto', 300), 'curto');

  const longo = 'um nome absurdamente comprido que não caberia nem em dobro dessa largura';
  const cortado = fitText(ctx, longo, 200);

  assert.notEqual(cortado, longo);
  assert.ok(cortado.endsWith('…'), `esperava reticências no fim, veio "${cortado}"`);
  assert.ok(ctx.measureText(cortado).width <= 200, 'o corte tem de caber na largura pedida');
  assert.ok(longo.startsWith(cortado.slice(0, -1)), 'o corte é um prefixo do original');
});

test('fitText devolve vazio quando não cabe nem uma reticência', { skip: !temFonte }, () => {
  const ctx = createCanvas(400, 100).getContext('2d');
  ctx.font = `20px ${fontStacks().body}`;

  assert.equal(fitText(ctx, 'qualquer coisa', 1), '');
  assert.equal(fitText(ctx, 'qualquer coisa', 0), '');
});

test('a altura da página acompanha o número de linhas', () => {
  const fixo = TOP.padding * 2 + TOP.headerHeight + TOP.footerHeight;

  assert.equal(cardHeight(9, true), fixo + TOP.heroHeight + TOP.rowHeight * 9 + TOP.rowGap * 9);
  assert.equal(cardHeight(10, false), fixo + TOP.rowHeight * 10 + TOP.rowGap * 9);
  assert.equal(cardHeight(0, false), fixo + TOP.emptyHeight, 'ranking vazio usa o bloco de aviso');
});

test('página incompleta sai mais curta que a cheia', () => {
  assert.ok(
    cardHeight(2, false) < cardHeight(9, true),
    'três posições não podem gerar uma imagem com dez linhas de altura'
  );
});

test('a assinatura da página muda quando o XP muda', () => {
  const base = {
    guildId: '1',
    guildName: 'Servidor',
    page: 1,
    pages: 2,
    total: 20,
    entries: entradas(3),
    headline: null,
    backgroundUrl: null,
  };

  assert.equal(pageSignature(base), pageSignature({ ...base, entries: entradas(3) }));

  const comXpNovo = { ...base, entries: base.entries.map((e, i) => (i ? e : { ...e, totalXp: e.totalXp + 1 })) };
  assert.notEqual(pageSignature(base), pageSignature(comXpNovo), 'XP novo tem de invalidar a imagem');

  assert.notEqual(pageSignature(base), pageSignature({ ...base, page: 2 }));
  assert.notEqual(pageSignature(base), pageSignature({ ...base, headline: 'frase' }));
  assert.notEqual(pageSignature(base), pageSignature({ ...base, backgroundUrl: 'https://exemplo.test/f.png' }));
});

// --- Avatares --------------------------------------------------------------

test('o mesmo avatar é baixado uma única vez', async () => {
  avatarCache.clear();
  const url = 'https://cdn.test/avatar-unico.png';
  let chamadas = 0;

  const deps = {
    fetcher: async () => {
      chamadas += 1;
      return Buffer.from([1, 2, 3]);
    },
    decoder: async () => imagemFalsa(),
  };

  await loadAvatar(url, deps);
  await loadAvatar(url, deps);
  await loadAvatars([url, url, url], deps);

  assert.equal(chamadas, 1, 'a URL já tem o hash do arquivo, então cache acertado é cache válido');
});

test('avatares repetidos na mesma página rendem um download por URL', async () => {
  avatarCache.clear();
  const baixadas = [];
  const deps = {
    fetcher: async (url) => {
      baixadas.push(url);
      return Buffer.from([1]);
    },
    decoder: async () => imagemFalsa(),
  };

  const mapa = await loadAvatars(
    ['https://cdn.test/a.png', 'https://cdn.test/b.png', 'https://cdn.test/a.png', null, ''],
    deps
  );

  assert.deepEqual(baixadas.sort(), ['https://cdn.test/a.png', 'https://cdn.test/b.png']);
  assert.equal(mapa.size, 2, 'null e string vazia não entram no mapa');
});

test('falha no download do avatar vira reserva, não exceção', async () => {
  avatarCache.clear();
  const url = 'https://cdn.test/avatar-que-falha.png';
  let chamadas = 0;

  const deps = {
    fetcher: async () => {
      chamadas += 1;
      throw new Error('socket fechou');
    },
    decoder: async () => imagemFalsa(),
  };

  assert.equal(await loadAvatar(url, deps), null);
  assert.equal(await loadAvatar(url, deps), null);
  assert.equal(chamadas, 1, 'o null também fica em cache: insistir não muda o resultado');
});

test('avatar sem URL não chega a tentar rede', async () => {
  avatarCache.clear();
  const deps = {
    fetcher: async () => assert.fail('não deveria baixar nada'),
    decoder: async () => imagemFalsa(),
  };

  assert.equal(await loadAvatar(null, deps), null);
  assert.equal(await loadAvatar(undefined, deps), null);
  assert.equal(await loadAvatar('', deps), null);
});

// --- Fundo remoto ----------------------------------------------------------

test('fundo sem URL configurada não faz download', async () => {
  backgroundCache.clear();
  const deps = { fetcher: async () => assert.fail('não deveria baixar nada'), decoder: async () => imagemFalsa() };

  assert.equal(await loadBackgroundImage(null, deps), null);
  assert.equal(await loadBackgroundImage('', deps), null);
});

test('fundo recusado pelo download cai no gerado e não é tentado de novo', async () => {
  backgroundCache.clear();
  const url = 'https://exemplo.test/fundo-grande.png';
  let chamadas = 0;

  const deps = {
    fetcher: async () => {
      chamadas += 1;
      return { ok: false, error: 'imagem grande demais' };
    },
    decoder: async () => imagemFalsa(),
  };

  assert.equal(await loadBackgroundImage(url, deps), null);
  assert.equal(await loadBackgroundImage(url, deps), null);
  assert.equal(chamadas, 1, 'uma URL errada na config não pode custar um download por página');
});

test('fundo aceito é decodificado uma vez e reusado', async () => {
  backgroundCache.clear();
  const url = 'https://exemplo.test/fundo-bom.png';
  let decodificacoes = 0;

  const deps = {
    fetcher: async () => ({ ok: true, bytes: Buffer.from([1, 2]), contentType: 'image/png' }),
    decoder: async () => {
      decodificacoes += 1;
      return imagemFalsa(1600, 900);
    },
  };

  const primeira = await loadBackgroundImage(url, deps);
  const segunda = await loadBackgroundImage(url, deps);

  assert.equal(primeira, segunda);
  assert.equal(decodificacoes, 1);
});

// --- Render ----------------------------------------------------------------

const dadosDePagina = (overrides = {}) => ({
  guildId: '900000000000000001',
  guildName: 'Servidor de Testes',
  page: 1,
  pages: 3,
  total: 25,
  pageSize: 10,
  entries: entradas(10),
  headline: 'Frase do topo',
  backgroundUrl: null,
  ...overrides,
});

test('renderLeaderboardCard devolve um PNG plausível', { skip: !temFonte }, async () => {
  pageCache.clear();
  const buffer = await renderLeaderboardCard(dadosDePagina());

  assert.ok(Buffer.isBuffer(buffer), 'com fonte instalada a imagem tem de sair');
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'assinatura PNG');
  assert.ok(buffer.length > 5000, `PNG suspeitosamente pequeno: ${buffer.length} bytes`);
});

test('a mesma página não é redesenhada, e XP novo redesenha', { skip: !temFonte }, async () => {
  pageCache.clear();
  const dados = dadosDePagina();

  const primeira = await renderLeaderboardCard(dados);
  const segunda = await renderLeaderboardCard(dados);
  assert.equal(primeira, segunda, 'chave repetida devolve o mesmo Buffer, sem passar pelo canvas');

  const comXpNovo = await renderLeaderboardCard({
    ...dados,
    entries: dados.entries.map((e, i) => (i ? e : { ...e, totalXp: e.totalXp + 1000 })),
  });
  assert.notEqual(primeira, comXpNovo, 'XP diferente é imagem diferente');
});

test('ranking vazio e página incompleta também rendem imagem', { skip: !temFonte }, async () => {
  pageCache.clear();

  const vazio = await renderLeaderboardCard(dadosDePagina({ entries: [], total: 0, pages: 1 }));
  assert.ok(Buffer.isBuffer(vazio), 'sem ninguém pontuado a imagem explica isso, não falha');

  const ultima = await renderLeaderboardCard(
    dadosDePagina({ page: 3, entries: entradas(3, 21), headline: null })
  );
  assert.ok(Buffer.isBuffer(ultima));
});
