const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { logError, resetErrorStats } = require('../utils/observability');
const { startHealthServer } = require('../utils/healthServer');

function request(port, path = '/health') {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

test('HTTP expõe só readiness e escuta em loopback por padrão ou HEALTH_HOST explícito', async (t) => {
  const oldPort = process.env.HEALTH_PORT;
  const oldHost = process.env.HEALTH_HOST;
  t.after(() => {
    if (oldPort === undefined) delete process.env.HEALTH_PORT;
    else process.env.HEALTH_PORT = oldPort;
    if (oldHost === undefined) delete process.env.HEALTH_HOST;
    else process.env.HEALTH_HOST = oldHost;
    resetErrorStats();
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    logError('secret', new Error('private-message'), { token: 'private-token' });
  } finally {
    console.error = originalError;
  }

  let ready = false;
  const client = { isReady: () => ready, user: { tag: 'private-bot' } };
  for (const host of [undefined, '0.0.0.0']) {
    process.env.HEALTH_PORT = String(await new Promise((resolve, reject) => {
      const probe = http.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    }));
    if (host === undefined) delete process.env.HEALTH_HOST;
    else process.env.HEALTH_HOST = host;
    const originalLog = console.log;
    console.log = () => {};
    let server;
    try {
      server = startHealthServer(client);
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    } finally {
      console.log = originalLog;
    }
    assert.equal(server.address().address, host ?? '127.0.0.1');
    const port = server.address().port;
    assert.deepEqual(await request(port), { status: 503, body: '{"ready":false}' });
    ready = true;
    assert.deepEqual(await request(port), { status: 200, body: '{"ready":true}' });
    assert.deepEqual(await request(port, '/other'), { status: 404, body: 'Not found' });
    ready = false;
    await new Promise((resolve) => server.close(resolve));
  }
});
