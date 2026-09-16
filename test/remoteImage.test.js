/**
 * Testes das duas defesas do download remoto: a tabela de IPs internos (que é o
 * que fecha o SSRF quando o hostname é público) e o corte por stream (que é o
 * que impede um servidor sem `content-length` de encher a memória).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const dns = require('node:dns').promises;

const { fetchRemoteImage, isPrivateIp, readCapped } = require('../utils/remoteImage');

test('isPrivateIp barra loopback, rede local, link-local e CGNAT', () => {
  for (const ip of [
    '127.0.0.1',
    '127.99.1.2',
    '10.0.0.7',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254', // metadata das clouds — o alvo clássico de SSRF
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1234',
    'fec0::1', // site-local legado
    'ff02::1', // multicast (all-nodes)
    'ff05::1:3',
    '64:ff9b::7f00:1',
    '::ffff:127.0.0.1', // IPv4 disfarçado de IPv6
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} deveria ser bloqueado`);
  }
});

test('isPrivateIp libera endereços públicos', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '192.169.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} deveria passar`);
  }
});

test('isPrivateIp bloqueia o que não sabe ler', () => {
  for (const ip of ['', 'nao-e-ip', '1.2.3', '999.1.1.1', '1.2.3.4.5']) {
    assert.equal(isPrivateIp(ip), true, `${JSON.stringify(ip)} deveria ser bloqueado`);
  }
});

test('isPrivateIp aceita a forma com colchetes e zona', () => {
  assert.equal(isPrivateIp('[::1]'), true);
  assert.equal(isPrivateIp('fe80::1%eth0'), true);
});

/** Resposta de mentira com só o `body` que o readCapped lê. */
const bodyOf = (chunks) => ({ body: Readable.from(chunks) });

test('readCapped devolve o corpo inteiro quando cabe no limite', async () => {
  const result = await readCapped(bodyOf([Buffer.alloc(10, 1), Buffer.alloc(5, 2)]), 100);
  assert.equal(result.ok, true);
  assert.equal(result.bytes.length, 15);
});

test('readCapped corta sem ler o resto quando passa do limite', async () => {
  let lidos = 0;
  const infinito = (async function* () {
    while (true) {
      lidos += 1;
      yield Buffer.alloc(1024);
    }
  })();

  const result = await readCapped({ body: infinito }, 4096);

  assert.equal(result.ok, false);
  assert.ok(result.seen > 4096);
  // O ponto do teste: parou logo depois de estourar, não leu o stream inteiro.
  assert.ok(lidos <= 6, `leu ${lidos} pedaços`);
});

test('readCapped aceita resposta sem corpo', async () => {
  const result = await readCapped({ body: null }, 10);
  assert.equal(result.ok, true);
  assert.equal(result.bytes.length, 0);
});

const headers = (values) => ({ get: (name) => values[name.toLowerCase()] ?? null });
const image = (body = ['img'], extra = {}) => ({
  ok: true,
  status: 200,
  headers: headers({ 'content-type': 'image/png', ...extra.headers }),
  body: Readable.from(body),
});

test('fetchRemoteImage barra DNS privado antes do fetch', async (t) => {
  let fetched = false;
  t.mock.method(dns, 'lookup', async () => [{ address: '127.0.0.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => { fetched = true; });

  const result = await fetchRemoteImage('https://cdn.example/a.png', { maxBytes: 10 });

  assert.equal(result.ok, false);
  assert.match(result.error, /não é público/);
  assert.equal(fetched, false);
});

test('fetchRemoteImage revalida redirecionamento para rede interna', async (t) => {
  t.mock.method(dns, 'lookup', async (host) => [{ address: host === 'safe.example' ? '1.1.1.1' : '10.0.0.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 302, headers: headers({ location: 'https://evil.example/a.png' }) }));

  const result = await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 });

  assert.equal(result.ok, false);
  assert.match(result.error, /não é público/);
});

test('fetchRemoteImage limita redirects e aceita URL relativa segura', async (t) => {
  let calls = 0;
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => {
    calls += 1;
    return { ok: false, status: 302, headers: headers({ location: '/next.png' }) };
  });

  const result = await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 });

  assert.equal(result.ok, false);
  assert.match(result.error, /vezes demais/);
  assert.equal(calls, 4);
});

test('fetchRemoteImage cobre timeout, MIME inválido e 404', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => { throw Object.assign(new Error('late'), { name: 'TimeoutError' }); });
  assert.match((await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 })).error, /tempo esgotado/);

  t.mock.reset();
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, headers: headers({ 'content-type': 'text/html' }), body: Readable.from(['x']) }));
  assert.match((await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 })).error, /imagem/);

  t.mock.reset();
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 404, headers: headers({}), body: null }));
  assert.match((await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 })).error, /não encontrada/);
});

test('fetchRemoteImage confere content-length e corta stream mentiroso/interrompido', async (t) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => image([], { headers: { 'content-length': '99' } }));
  assert.match((await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 })).error, /limite/);

  t.mock.reset();
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => image([Buffer.alloc(6), Buffer.alloc(6)], { headers: { 'content-length': '1' } }));
  assert.match((await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 })).error, /limite/);

  t.mock.reset();
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }]);
  t.mock.method(global, 'fetch', async () => image((async function* () { throw new Error('boom'); })()));
  assert.match((await fetchRemoteImage('https://safe.example/a.png', { maxBytes: 10 })).error, /interrompida/);
});
