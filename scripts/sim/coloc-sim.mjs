// Co-Location-Simulation ohne Brille: zwei Browser (Firefox headless) mit dem Immersive Web Emulator (IWER).
//
//   npm run build && npx vite preview --port 8765 &   (oder python3 -m http.server -d dist 8765)
//   node server/index.js &
//   node scripts/sim/coloc-sim.mjs [http://localhost:8765] [ws://localhost:8787/signal]
//
// Ablauf: Host und Gast stehen in einem gedachten realen Raum Rücken an Rücken. Das Koordinatensystem des Gastes ist
// absichtlich gegenüber der Welt verdreht und verschoben (wie bei zwei echten Brillen). Beide halten den Trigger,
// der Countdown läuft, beide erfassen. Danach bewegt sich der Gast an eine bekannte reale Stelle: Der Avatar des Gastes
// beim Host muss dort erscheinen (und umgekehrt), und beide Bretter müssen an derselben realen Stelle liegen.
// Benötigt: puppeteer-core und Firefox (FIREFOX=/pfad/zu/firefox).
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:8765';
const SIG = process.argv[3] ?? 'ws://localhost:8787/signal';
const FIREFOX = process.env.FIREFOX ?? '/usr/bin/firefox';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOM = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

// Gast-System = Welt gedreht um THETA, verschoben um T (dem Spiel unbekannt)
const THETA = 0.8;
const T = { x: 1.0, z: -2.0 };
const rot = (p, a) => ({ x: p.x * Math.cos(a) + p.z * Math.sin(a), z: -p.x * Math.sin(a) + p.z * Math.cos(a) });
const worldToGuest = (p) => {
  const r = rot(p, THETA);
  return { x: r.x + T.x, z: r.z + T.z };
};
const guestToWorld = (p) => rot({ x: p.x - T.x, z: p.z - T.z }, -THETA);

async function open(role) {
  const browser = await puppeteer.launch({ browser: 'firefox', executablePath: FIREFOX, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 600 });
  page.on('pageerror', (e) => console.log(`[${role} pageerror]`, e.message));
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('myzel-schach.settings.v1', JSON.stringify({ quality: 'low', lang: 'de', insects: false })));
  const extra = role === 'host' ? '&color=w&bounds=5x5' : '';
  await page.goto(`${BASE}/?autostart=coloc&netroom=${ROOM}&role=${role}&vr=1&xremu=1&stereo=1${extra}&signal=${encodeURIComponent(SIG)}`, { waitUntil: 'load' });
  return { browser, page };
}

/** Kopfpose (Welt bzw. Gast-System) setzen: Position xz, Höhe, Yaw */
async function setHead(page, p, yaw) {
  await page.evaluate((p, yaw) => {
    const d = window.__myzelXR;
    d.position.set(p.x, 1.6, p.z);
    d.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    // Controller vor dem Körper
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    d.controllers.right.position.set(p.x + fx * 0.3 + 0.1, 1.1, p.z + fz * 0.3);
    d.controllers.left.position.set(p.x + fx * 0.3 - 0.1, 1.1, p.z + fz * 0.3);
  }, p, yaw);
}

async function enterVR(page) {
  const b = await page.evaluate(() => { const r = document.querySelector('.vr-enter').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(b.x, b.y);
}

const H = await open('host');
await wait(5000);
const G = await open('guest');
await wait(7000);

// Rücken an Rücken: Host bei (−0.15, 0) schaut nach −X, Gast hinter ihm bei (0.15, 0) schaut nach +X (Welt)
const hostWorld = { x: -0.15, z: 0 };
const hostYaw = Math.PI / 2;
const guestWorld = { x: 0.15, z: 0 };
const guestYawWorld = -Math.PI / 2;
await setHead(H.page, hostWorld, hostYaw);
await setHead(G.page, worldToGuest(guestWorld), guestYawWorld + THETA);
await enterVR(H.page);
await enterVR(G.page);
await wait(4000);
const phase = (p) => p.evaluate(() => window.myzel.vr.coloc?.phase ?? 'none');
console.log('Phase nach VR-Eintritt:', await phase(H.page), await phase(G.page));

// beide halten den Trigger 2,5 s
for (const p of [H.page, G.page]) await p.evaluate(() => window.__myzelXR.controllers.right.updateButtonValue('trigger', 1));
await wait(2800);
for (const p of [H.page, G.page]) await p.evaluate(() => window.__myzelXR.controllers.right.updateButtonValue('trigger', 0));
console.log('Phase nach Halten:', await phase(H.page), await phase(G.page));
await wait(5000); // Countdown 3 s + Erfassung 0,5 s + Austausch
console.log('Phase nach Countdown:', await phase(H.page), await phase(G.page));

// Gast geht an eine bekannte reale Stelle, Host bleibt
const guestTarget = { x: -1.1, z: 0.9 };
await setHead(G.page, worldToGuest(guestTarget), guestYawWorld + THETA);
await setHead(H.page, { x: 0.9, z: -0.4 }, hostYaw);
await wait(2500);
const avatarHead = (p) => p.evaluate(() => { const n = window.myzel.net; return n.avatar.root.visible ? n.avatar.headWorld().toArray() : null; });
const boardCenter = (p) => p.evaluate(() => { const b = window.myzel.board.root; return { x: b.position.x, z: b.position.z, yaw: b.rotation.y, s: b.scale.x }; });
const hAv = await avatarHead(H.page);
const gAv = await avatarHead(G.page);
const hB = await boardCenter(H.page);
const gB = await boardCenter(G.page);
const gBw = guestToWorld(gB);
const err = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const results = {
  room: ROOM,
  // Avatar des Gastes beim Host (Host-System = Welt) muss bei guestTarget stehen
  guestAvatarAtHost: hAv && { x: +hAv[0].toFixed(3), z: +hAv[2].toFixed(3), errCm: +(err({ x: hAv[0], z: hAv[2] }, guestTarget) * 100).toFixed(2) },
  // Avatar des Hosts beim Gast (Gast-System) → zurück in Welt muss bei (0.9, −0.4) stehen
  hostAvatarAtGuest: gAv && (() => { const w = guestToWorld({ x: gAv[0], z: gAv[2] }); return { x: +w.x.toFixed(3), z: +w.z.toFixed(3), errCm: +(err(w, { x: 0.9, z: -0.4 }) * 100).toFixed(2) }; })(),
  boardHostWorld: { x: +hB.x.toFixed(3), z: +hB.z.toFixed(3), s: +hB.s.toFixed(3) },
  boardGuestWorld: { x: +gBw.x.toFixed(3), z: +gBw.z.toFixed(3), s: +gB.s.toFixed(3) },
  boardErrCm: +(err(hB, gBw) * 100).toFixed(2),
  boardYawErrDeg: +((((gB.yaw - THETA - hB.yaw) * 180) / Math.PI + 540) % 360 - 180).toFixed(2),
};
console.log(JSON.stringify(results, null, 1));
const ok = results.guestAvatarAtHost?.errCm < 5 && results.hostAvatarAtGuest?.errCm < 5 && results.boardErrCm < 2 && Math.abs(results.boardYawErrDeg) < 1;
console.log(ok ? 'OK: Avatare liegen übereinander, Bretter deckungsgleich.' : 'FEHLER: Abweichung zu groß.');
if (process.env.SHOTS) {
  await H.page.screenshot({ path: `${process.env.SHOTS}/coloc_host.png` });
  await G.page.screenshot({ path: `${process.env.SHOTS}/coloc_guest.png` });
}
await H.browser.close();
await G.browser.close();
process.exit(ok ? 0 : 1);
