/**
 * Endpoint HTTP de health check.
 *
 * Existe para quem hospeda o bot (Docker, Render, Railway, systemd, uptime
 * monitor): o comando `/health` só serve a quem já está no Discord, e um
 * orquestrador precisa de um HTTP 200/503 para decidir reiniciar o container.
 *
 * Opt-in por `HEALTH_PORT`. Serve apenas GET /health, sem detalhes do processo.
 * A porta fica em loopback salvo quando HEALTH_HOST é configurado explicitamente.
 */

const http = require('node:http');

function startHealthServer(client) {
  const raw = process.env.HEALTH_PORT;
  if (!raw) return null;

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`[health] HEALTH_PORT inválido (${raw}); endpoint desligado.`);
    return null;
  }

  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || new URL(req.url, 'http://localhost').pathname !== '/health') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    // 503 com o gateway caído: o processo está vivo, mas o bot não atende ninguém.
    const ready = Boolean(client?.isReady?.());
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ready }));
  });

  const host = process.env.HEALTH_HOST?.trim() || '127.0.0.1';
  server.on('error', (err) => console.error('[health] Servidor falhou:', err.message));
  server.listen(port, host, () => console.log(`[health] Health check em http://${host}:${port}/health`));
  return server;
}

module.exports = { startHealthServer };
