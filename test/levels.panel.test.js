/**
 * Limites estruturais do painel do `/levelconfig`.
 *
 * Estes testes existem por causa de um erro real: a linha de "Cantos e véu" junta
 * dois ajustes independentes num select de escolha única, e marcar o valor atual dos
 * dois com `default` manda **duas** opções pré-selecionadas num menu que aceita uma.
 * O Discord não recusa só aquela linha — devolve `50035` e a mensagem inteira não é
 * enviada, então a tela simplesmente não abre.
 *
 * Nada disso aparece em teste de render nem de normalização: o payload é montado sem
 * erro, é a API que rejeita. Por isso a checagem é sobre a **forma** do payload, e
 * roda para todas as telas em vez de só para a que quebrou — é a mesma armadilha em
 * qualquer select com `default`, e a próxima linha de componente que alguém somar vai
 * passar por aqui antes de chegar ao Discord.
 *
 * Os números vêm da documentação de componentes do Discord e valem para toda mensagem.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');

const { DEFAULT_THEME, THEME_PRESETS, ACCENT_COLORS, THEME_TOGGLES } = require('../config/levels');
const { normalizeConfig } = require('../utils/levels/config');
const { VIEWS, buildPanelPayload } = require('../handlers/levelsSetupHandler');

const LIMITS = Object.freeze({
  rows: 5,
  buttonsPerRow: 5,
  selectOptions: 25,
  customId: 100,
  label: 80,
  optionLabel: 100,
  optionDescription: 100,
  placeholder: 150,
});

/** Servidor de mentira: só o que os payloads leem. */
const fakeGuild = () => {
  const channel = { id: '900000000000000001', name: 'geral' };
  return {
    id: '900000000000000000',
    name: 'Servidor de Teste',
    channels: { cache: new Collection([[channel.id, channel]]) },
    roles: { cache: new Collection() },
  };
};

/**
 * Afirma que uma linha de componentes cabe nas regras do Discord.
 *
 * @param {any} row linha já em JSON
 * @param {string} onde rótulo para a mensagem de falha
 */
function assertRow(row, onde) {
  const componentes = row.components ?? [];
  assert.ok(componentes.length > 0, `${onde}: linha vazia não é aceita`);

  const selects = componentes.filter((c) => c.type !== 2);
  if (selects.length) {
    assert.equal(componentes.length, 1, `${onde}: select ocupa a linha inteira`);
  } else {
    assert.ok(
      componentes.length <= LIMITS.buttonsPerRow,
      `${onde}: ${componentes.length} botões numa linha (máximo ${LIMITS.buttonsPerRow})`
    );
  }

  for (const componente of componentes) {
    assert.ok(
      componente.custom_id.length <= LIMITS.customId,
      `${onde}: custom_id de ${componente.custom_id.length} chars — "${componente.custom_id}"`
    );

    if (componente.type === 2) {
      if (componente.label) {
        assert.ok(componente.label.length <= LIMITS.label, `${onde}: rótulo longo — "${componente.label}"`);
      }
      continue;
    }

    if (componente.placeholder) {
      assert.ok(
        componente.placeholder.length <= LIMITS.placeholder,
        `${onde}: placeholder de ${componente.placeholder.length} chars`
      );
    }

    const opcoes = componente.options ?? [];
    if (componente.type === 3) {
      assert.ok(opcoes.length > 0, `${onde}: select de texto sem opção`);
      assert.ok(
        opcoes.length <= LIMITS.selectOptions,
        `${onde}: ${opcoes.length} opções (máximo ${LIMITS.selectOptions})`
      );

      const valores = opcoes.map((opcao) => opcao.value);
      assert.equal(new Set(valores).size, valores.length, `${onde}: valores repetidos entre as opções`);

      for (const opcao of opcoes) {
        assert.ok(opcao.label.length <= LIMITS.optionLabel, `${onde}: rótulo de opção longo — "${opcao.label}"`);
        if (opcao.description) {
          assert.ok(
            opcao.description.length <= LIMITS.optionDescription,
            `${onde}: descrição de opção longa — "${opcao.description}"`
          );
        }
      }
    }

    // O erro que motivou o arquivo: `default` marcado além do que o menu aceita.
    const max = componente.max_values ?? 1;
    const marcadas = opcoes.filter((opcao) => opcao.default).length;
    assert.ok(
      marcadas <= max,
      `${onde}: ${marcadas} opções marcadas por default num select que aceita ${max}`
    );

    const min = componente.min_values ?? 1;
    assert.ok(min <= max, `${onde}: min_values (${min}) acima de max_values (${max})`);
  }
}

/**
 * Roda a checagem inteira sobre um payload de painel.
 *
 * @param {any} payload
 * @param {string} onde
 */
function assertPayload(payload, onde) {
  const linhas = (payload.components ?? []).map((row) => (typeof row.toJSON === 'function' ? row.toJSON() : row));

  assert.ok(linhas.length <= LIMITS.rows, `${onde}: ${linhas.length} linhas de componente (máximo ${LIMITS.rows})`);
  linhas.forEach((row, index) => assertRow(row, `${onde} · linha ${index + 1}`));
}

// ---------------------------------------------------------------------------

test('toda tela do painel monta componentes que o Discord aceita', () => {
  const config = normalizeConfig({});
  const guild = fakeGuild();

  for (const view of VIEWS) {
    assertPayload(buildPanelPayload(config, guild, view), `tela ${view}`);
  }
});

test('a tela de aparência cabe nos limites nos dois modos de preview', () => {
  const config = normalizeConfig({});
  const guild = fakeGuild();

  for (const mode of ['top', 'rank']) {
    const payload = buildPanelPayload(config, guild, 'appearance', '', null, /** @type {any} */ (mode));
    assertPayload(payload, `aparência (${mode})`);
    assert.equal(payload.components.length, LIMITS.rows, 'a tela usa exatamente as cinco linhas disponíveis');
  }
});

test('nenhuma combinação de tema estoura os defaults dos selects', () => {
  const guild = fakeGuild();

  // O caso original: canto e véu diferentes do padrão ao mesmo tempo, que é o
  // estado em que o select combinado teria dois valores atuais a marcar.
  const combinacoes = [
    { corners: 'square', veil: 0 },
    { corners: 'square', veil: 90 },
    { corners: 'rounded', veil: 30 },
    { cardColor: '#101014', accentColor: '#ff0000' },
    { veil: 70, cardColor: '#ffffff' },
    ...Object.keys(THEME_PRESETS).map((preset) => ({ preset })),
    ...Object.keys(ACCENT_COLORS).map((accent) => ({ accent })),
    // Todos os liga/desliga apagados, e todos acesos: o multi-select aceita seis
    // defaults, mas só porque `maxValues` é seis — vale afirmar as duas pontas.
    Object.fromEntries(THEME_TOGGLES.map((toggle) => [toggle.key, false])),
    Object.fromEntries(THEME_TOGGLES.map((toggle) => [toggle.key, true])),
  ];

  for (const variacao of combinacoes) {
    const config = normalizeConfig({ theme: { ...DEFAULT_THEME, ...variacao } });
    assertPayload(
      buildPanelPayload(config, guild, 'appearance', '', null, 'top'),
      `aparência com ${JSON.stringify(variacao)}`
    );
  }
});

test('as telas fora da aparência limpam o anexo do preview', () => {
  const config = normalizeConfig({});
  const guild = fakeGuild();

  for (const view of VIEWS.filter((v) => v !== 'appearance')) {
    const payload = buildPanelPayload(config, guild, view);
    assert.deepEqual(payload.files, [], `tela ${view} não manda arquivo`);
    assert.deepEqual(payload.attachments, [], `tela ${view} descarta o anexo anterior`);
  }
});
