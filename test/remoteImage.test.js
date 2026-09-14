/**
 * Testes das duas defesas do download remoto: a tabela de IPs internos (que é o
 * que fecha o SSRF quando o hostname é público) e o corte por stream (que é o
 * que impede um servidor sem `content-length` de encher a memória).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { isPrivateIp, readCapped } = require('../utils/remoteImage');

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
