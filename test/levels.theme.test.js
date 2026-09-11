/**
 * Testes do tema das imagens do ranking.
 *
 * Duas garantias organizam o arquivo. A primeira é a de sempre nesta config: entrada
 * estranha **nunca lança** — um hex digitado errado tem de voltar ao preset, não
 * impedir o painel de abrir. A segunda é específica desta mudança: quem nunca mexeu
 * na aparência precisa continuar recebendo exatamente a imagem de antes, então o
 * visual do tema padrão é comparado com a paleta que estava escrita à mão.
 *
 * A tinta do texto não é escolhida pelo admin — é derivada da luminância do papel. É
 * o que garante que um hex qualquer continue legível, e é afirmado aqui pela relação
 * entre as luminâncias, não pelo hex exato, que pode ser reajustado sem quebrar nada.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { THEME_PRESETS, ACCENT_COLORS, THEME_TOGGLES, DEFAULT_THEME, DEFAULT_CONFIG, LIMITS } =
  require('../config/levels');
const { normalizeTheme, normalizeHexColor, normalizeConfig } = require('../utils/levels/config');
const { COLORS, TOP, RANK } = require('../utils/levels/card/theme');
const { resolveVisual, contrastInk, luminance, themeSignature, mix, withAlpha } =
  require('../utils/levels/card/visual');

// ---------------------------------------------------------------------------
// normalizeHexColor
// ---------------------------------------------------------------------------

test('normalizeHexColor aceita as formas que uma pessoa digita', () => {
  assert.equal(normalizeHexColor('#e8e6de'), '#e8e6de');
  assert.equal(normalizeHexColor('E8E6DE'), '#e8e6de', 'sem # e em maiúscula');
  assert.equal(normalizeHexColor('  #abc  '), '#aabbcc', 'três dígitos expandem');
  assert.equal(normalizeHexColor('#ABC'), '#aabbcc');
});

test('normalizeHexColor devolve null no que não é cor', () => {
  for (const entrada of ['', '   ', 'vermelho', '#12', '#12345', '#gggggg', '#1234567', null, undefined, 42, {}]) {
    assert.equal(normalizeHexColor(entrada), null, `recusa ${JSON.stringify(entrada)}`);
  }
});

// ---------------------------------------------------------------------------
// normalizeTheme
// ---------------------------------------------------------------------------

test('normalizeTheme cai no padrão com entrada ausente ou lixo', () => {
  for (const entrada of [undefined, null, 'paper', 42, [], { preset: 'nao-existe', accent: 'nao-existe' }]) {
    assert.deepEqual(normalizeTheme(entrada), DEFAULT_THEME, `entrada ${JSON.stringify(entrada)}`);
  }
});

test('normalizeTheme aceita só chave existente no catálogo', () => {
  const chaves = Object.keys(THEME_PRESETS);
  const outro = chaves.find((key) => key !== DEFAULT_THEME.preset);
  assert.equal(normalizeTheme({ preset: outro }).preset, outro);
  assert.equal(normalizeTheme({ preset: 'PAPER' }).preset, DEFAULT_THEME.preset, 'chave é sensível a caixa');

  const accent = Object.keys(ACCENT_COLORS).find((key) => key !== DEFAULT_THEME.accent);
  assert.equal(normalizeTheme({ accent }).accent, accent);
  assert.equal(normalizeTheme({ accent: 'arco-iris' }).accent, DEFAULT_THEME.accent);
});

test('normalizeTheme gruda o véu na faixa e aceita número em texto', () => {
  assert.equal(normalizeTheme({ veil: -30 }).veil, LIMITS.veil.min);
  assert.equal(normalizeTheme({ veil: 500 }).veil, LIMITS.veil.max);
  assert.equal(normalizeTheme({ veil: '40' }).veil, 40, 'o select manda texto');
  assert.equal(normalizeTheme({ veil: 'muito' }).veil, DEFAULT_THEME.veil);
});

test('normalizeTheme normaliza cantos, cores e booleanos', () => {
  assert.equal(normalizeTheme({ corners: 'square' }).corners, 'square');
  assert.equal(normalizeTheme({ corners: 'redondo' }).corners, DEFAULT_THEME.corners);

  assert.equal(normalizeTheme({ cardColor: 'ABC' }).cardColor, '#aabbcc');
  assert.equal(normalizeTheme({ cardColor: 'azul' }).cardColor, null, 'cor inválida volta ao preset');
  assert.equal(normalizeTheme({ accentColor: '#2A2C34' }).accentColor, '#2a2c34');

  for (const toggle of THEME_TOGGLES) {
    assert.equal(normalizeTheme({ [toggle.key]: false })[toggle.key], false, toggle.key);
    assert.equal(normalizeTheme({ [toggle.key]: '0' })[toggle.key], false, `${toggle.key} em texto`);
    assert.equal(normalizeTheme({ [toggle.key]: 'sim' })[toggle.key], true, `${toggle.key} em texto`);
  }
});

test('normalizeTheme corta o título no limite', () => {
  const longo = 'a'.repeat(LIMITS.titleChars + 30);
  assert.equal(normalizeTheme({ title: longo }).title.length, LIMITS.titleChars);
  assert.equal(normalizeTheme({ title: '  Hall da fama  ' }).title, 'Hall da fama');
  assert.equal(normalizeTheme({ title: '   ' }).title, null, 'só espaço não é título');
});

test('normalizeConfig embute o tema e o round-trip preserva', () => {
  assert.deepEqual(normalizeConfig({}).theme, DEFAULT_THEME);
  assert.deepEqual(normalizeConfig({ theme: 'lixo' }).theme, DEFAULT_THEME);
  assert.deepEqual(normalizeConfig({ theme: null }).theme, DEFAULT_CONFIG.theme);

  const escolhido = { preset: 'noir', accent: 'dourado', veil: 70, corners: 'square', showFooter: false };
  const uma = normalizeConfig({ theme: escolhido }).theme;
  const outra = normalizeConfig({ theme: uma }).theme;
  assert.deepEqual(outra, uma, 'normalizar o já normalizado não muda nada');
  assert.equal(uma.preset, 'noir');
  assert.equal(uma.showFooter, false);
  assert.equal(uma.showAvatars, true, 'o que não foi mexido fica no padrão');
});

// ---------------------------------------------------------------------------
// Tinta derivada
// ---------------------------------------------------------------------------

test('contrastInk devolve tinta escura em papel claro e clara em papel escuro', () => {
  for (const papel of ['#ffffff', '#e8e6de', '#f6e4e6', '#dfe3ea']) {
    assert.ok(luminance(contrastInk(papel)) < luminance(papel), `tinta escura sobre ${papel}`);
  }
  for (const papel of ['#000000', '#1c1d22', '#101418']) {
    assert.ok(luminance(contrastInk(papel)) > luminance(papel), `tinta clara sobre ${papel}`);
  }
});

test('todo preset do catálogo produz papel e tinta que contrastam', () => {
  for (const [key, preset] of Object.entries(THEME_PRESETS)) {
    const { colors } = resolveVisual({ ...DEFAULT_THEME, preset: key });
    const distancia = Math.abs(luminance(colors.ink) - luminance(preset.card));
    assert.ok(distancia > 0.35, `${key}: papel e tinta distantes (${distancia.toFixed(2)})`);
  }
});

test('mix e withAlpha ficam na faixa', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#000000', '#ffffff', 9), '#ffffff', 'fator fora da faixa gruda');
  assert.equal(withAlpha('#0d0e11', 0.5), 'rgba(13, 14, 17, 0.50)');
  assert.equal(withAlpha('#0d0e11', -2), 'rgba(13, 14, 17, 0.00)');
});

// ---------------------------------------------------------------------------
// resolveVisual
// ---------------------------------------------------------------------------

test('resolveVisual entrega todas as chaves de cor que o desenho consome', () => {
  const { colors } = resolveVisual(DEFAULT_THEME);
  for (const chave of Object.keys(COLORS)) {
    assert.ok(chave in colors, `falta a cor ${chave}`);
  }
});

test('o tema padrão reproduz a paleta que estava escrita à mão', () => {
  const { colors } = resolveVisual(undefined);

  // Um subconjunto curado, e não a paleta inteira: `veil`, `scrim` e `accentPlain`
  // passaram a derivar do preset em vez de hex soltos, e mudaram de valor em
  // diferenças que não se vêem. O que não pode mudar é o papel, a tinta e o texto.
  for (const chave of ['card', 'hero', 'ink', 'inkMuted', 'inkFaint', 'inkGhost', 'track', 'barFrom', 'barTo', 'pageText', 'pageMuted', 'pageFaint', 'rule', 'cardStroke', 'heroStroke', 'base']) {
    assert.equal(colors[chave], COLORS[chave], `cor ${chave}`);
  }
  assert.deepEqual([...colors.medals], [...COLORS.medals], 'medalhas do pódio');
  assert.ok(colors.veil.endsWith('0.50)'), 'véu ainda em 50%');
  assert.ok(colors.scrim.endsWith('0.82)'), 'scrim ainda em 82%');
});

test('o tema padrão não mexe nas medidas', () => {
  const v = resolveVisual(undefined);
  assert.equal(v.top.radius, TOP.radius);
  assert.equal(v.top.footerHeight, TOP.footerHeight);
  assert.equal(v.rank.radius, RANK.radius);
  assert.equal(v.title, null, 'sem título configurado, quem desenha usa o texto padrão');
});

test('cantos retos zeram os raios das duas imagens', () => {
  const v = resolveVisual({ ...DEFAULT_THEME, corners: 'square' });
  assert.equal(v.top.radius, 0);
  assert.equal(v.rank.radius, 0);
});

test('rodapé desligado não reserva altura', () => {
  assert.equal(resolveVisual({ ...DEFAULT_THEME, showFooter: false }).top.footerHeight, 0);
  assert.equal(resolveVisual({ ...DEFAULT_THEME, showFooter: false }).flags.showFooter, false);
});

test('medalhas desligadas viram a cor de destaque nas três posições', () => {
  const v = resolveVisual({ ...DEFAULT_THEME, showMedals: false });
  assert.deepEqual([...v.colors.medals], [v.colors.accent, v.colors.accent, v.colors.accent]);
});

test('papel escuro clareia as medalhas em vez de escurecê-las', () => {
  const claro = resolveVisual({ ...DEFAULT_THEME, preset: 'paper' });
  const escuro = resolveVisual({ ...DEFAULT_THEME, preset: 'noir' });
  assert.ok(
    luminance(escuro.colors.medals[0]) > luminance(claro.colors.medals[0]),
    'o ouro do noir é mais claro que o do papel'
  );
});

test('hex do papel manda no preset e continua legível', () => {
  const v = resolveVisual({ ...DEFAULT_THEME, preset: 'paper', cardColor: '#101014' });
  assert.equal(v.colors.card, '#101014');
  assert.ok(luminance(v.colors.ink) > luminance('#101014'), 'papel escolhido escuro recebe tinta clara');
  assert.ok(luminance(v.colors.hero) > luminance(v.colors.card), 'o destaque é mais claro que a linha comum');
});

test('hex do destaque manda na barra', () => {
  const v = resolveVisual({ ...DEFAULT_THEME, accent: 'grafite', accentColor: '#ff0000' });
  assert.equal(v.colors.barFrom, '#ff0000');
  assert.notEqual(v.colors.barTo, '#ff0000', 'a segunda parada é clareada para virar gradiente');
});

test('o véu acompanha o scrim', () => {
  const zero = resolveVisual({ ...DEFAULT_THEME, veil: 0 });
  const cheio = resolveVisual({ ...DEFAULT_THEME, veil: 90 });
  assert.ok(zero.colors.veil.endsWith('0.00)'));
  assert.ok(cheio.colors.veil.endsWith('0.90)'));
  assert.ok(
    Number(cheio.colors.scrim.match(/([\d.]+)\)$/)[1]) > Number(zero.colors.scrim.match(/([\d.]+)\)$/)[1]),
    'mais véu, mais proteção nas pontas'
  );
});

test('resolveVisual memoiza por tema e nunca lança', () => {
  const tema = { ...DEFAULT_THEME, preset: 'menta', veil: 20 };
  assert.equal(resolveVisual(tema), resolveVisual({ ...tema }), 'mesmo tema, mesmo objeto');
  assert.notEqual(resolveVisual(tema), resolveVisual({ ...tema, veil: 30 }));

  for (const entrada of [undefined, null, 'nada', 7, [], { preset: 42, veil: NaN, corners: {} }]) {
    assert.doesNotThrow(() => resolveVisual(entrada), `entrada ${JSON.stringify(entrada)}`);
  }
});

test('themeSignature muda com qualquer campo visível', () => {
  const base = themeSignature(DEFAULT_THEME);
  const variacoes = [
    { preset: 'noir' },
    { accent: 'dourado' },
    { cardColor: '#123456' },
    { accentColor: '#123456' },
    { veil: 10 },
    { corners: 'square' },
    { title: 'Hall da fama' },
    ...THEME_TOGGLES.map((toggle) => ({ [toggle.key]: false })),
  ];

  for (const variacao of variacoes) {
    assert.notEqual(themeSignature({ ...DEFAULT_THEME, ...variacao }), base, JSON.stringify(variacao));
  }
});
