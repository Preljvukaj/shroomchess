// @ts-check
/**
 * Myzel-Schach Signaling-Server: Node.js + WebSocket (Paket `ws`).
 *
 *   node server/index.js            → ws://0.0.0.0:8787/signal  (Health: GET /health)
 *
 * Umgebungsvariablen:
 *   PORT=8787            Port
 *   TRUST_PROXY=1        Client-IP aus X-Forwarded-For lesen (hinter nginx/Plesk-Proxy)
 *   ALLOWED_ORIGINS=…    kommagetrennte Liste erlaubter Origins (leer = alle)
 *
 * TLS (wss://) übernimmt der Reverse-Proxy (nginx/Plesk) – siehe README „Signaling-Server deployen“.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { RoomServer } from './rooms.js';

const PORT = Number(process.env.PORT ?? 8787);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const rooms = new RoomServer({ token: () => crypto.randomBytes(16).toString('hex') });

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, conns: rooms.conns.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0];
  if (path !== '/signal' && path !== '/') return socket.destroy();
  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin ?? '')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const id = crypto.randomUUID();
  const fwd = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  const ip = fwd || req.socket.remoteAddress || '?';
  let alive = true;
  rooms.connect(
    id,
    ip,
    (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    () => ws.close(),
  );
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    rooms.message(id, data.toString());
  });
  ws.on('pong', () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on('close', () => {
    clearInterval(hb);
    rooms.disconnect(id);
  });
  ws.on('error', () => ws.terminate());
});

setInterval(() => rooms.tick(), 5_000);

server.listen(PORT, () => console.log(`Myzel-Schach Signaling auf :${PORT} (/signal, /health)`));
