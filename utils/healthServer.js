/**
 * Endpoint HTTP de health check.
 *
 * Existe para quem hospeda o bot (Docker, Render, Railway, systemd, uptime
 * monitor): o comando `/health` só serve a quem já está no Discord, e um
 * orquestrador precisa de um HTTP 200/503 para decidir reiniciar o container.
 *
 * Opt-in por `HEALTH_PORT` — abrir porta sem alguém pedir é surpresa em
 * ambiente compartilhado. Serve apenas GET /health e nada mais: nenhum dado é
 * do usuário, então não há segredo a expor, mas 404 em todo o resto evita que a
 * porta seja confundida com uma API.
 */

const http = require('node:http');
const { healthSnapshot } = require('./observability');

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

    const snapshot = healthSnapshot(client);
    // 503 com o gateway caído: o processo está vivo, mas o bot não atende ninguém.
    res.writeHead(snapshot.ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(snapshot));
  });

  server.on('error', (err) => console.error('[health] Servidor falhou:', err.message));
  server.listen(port, () => console.log(`[health] Health check em http://localhost:${port}/health`));
  return server;
}

module.exports = { startHealthServer };
