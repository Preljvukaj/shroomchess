// Dev-Server für Desktop UND VR-Brillen (Meta Quest).
//
// Problem: WebXR braucht HTTPS. Tippt man auf der Quest nur "192.168.x.y:5173" ein, versucht
// der Browser http:// – und ein reiner HTTPS-Server antwortet darauf nicht ("kann nicht
// erreicht werden").
//
// Lösung: Auf dem öffentlichen Port (5173) lauscht eine Protokoll-Weiche. Sie liest das erste
// Byte jeder Verbindung:
//   0x16 (TLS-Handshake) → Verbindung roh an den Vite-HTTPS-Server (intern, Port 5174)
//   sonst (HTTP)         → Antwort "301 → https://<gleicher Host>/<Pfad>"
// So funktioniert die Adresse mit und ohne "https://".
import net from 'node:net';
import os from 'node:os';
import { createServer } from 'vite';
import { fork } from 'node:child_process';

// Signaling-Server (Online/Co-Location) gleich mitstarten – Vite leitet /signal dorthin weiter
const signaling = fork(new URL('../server/index.js', import.meta.url), [], { env: { ...process.env, PORT: '8787' } });
process.on('exit', () => signaling.kill());

const PUBLIC_PORT = Number(process.env.PORT ?? 5173);
const VITE_PORT = PUBLIC_PORT + 1;

const vite = await createServer({
  server: {
    host: '127.0.0.1',
    port: VITE_PORT,
    strictPort: true,
    // Der Browser verbindet den HMR-WebSocket über den öffentlichen Port (wss über die Weiche)
    hmr: { clientPort: PUBLIC_PORT },
    allowedHosts: true,
  },
});
await vite.listen();

const proxy = net.createServer((socket) => {
  socket.once('data', (first) => {
    if (first[0] === 0x16) {
      const upstream = net.connect(VITE_PORT, '127.0.0.1', () => {
        upstream.write(first);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      return;
    }
    // Klartext-HTTP: auf https umleiten
    const req = first.toString('latin1');
    const path = (req.split(' ')[1] ?? '/').replace(/[\r\n]/g, '');
    const host = (/^host:\s*([^\r\n]+)/im.exec(req)?.[1] ?? `localhost:${PUBLIC_PORT}`).trim();
    const target = `https://${host}${path.startsWith('/') ? path : '/'}`;
    socket.end(
      `HTTP/1.1 301 Moved Permanently\r\nLocation: ${target}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n` +
        `<p>Myzel-Schach braucht HTTPS (WebXR). Weiter zu <a href="${target}">${target}</a></p>`,
    );
  });
  socket.on('error', () => socket.destroy());
});

proxy.listen(PUBLIC_PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('\n  Myzel-Schach Dev-Server');
  console.log(`  ➜  Desktop:   https://localhost:${PUBLIC_PORT}/`);
  for (const ip of ips) console.log(`  ➜  Quest/LAN: https://${ip}:${PUBLIC_PORT}/   (auch ohne "https://" eintippbar)`);
  console.log('  Zertifikat ist selbstsigniert: einmal "Erweitert → Weiter" bestätigen.\n');
});
