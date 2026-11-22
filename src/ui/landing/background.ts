/**
 * Leichter animierter Hintergrund der Landingpage (Canvas 2D statt Three.js, damit die
 * Startseite ohne die 3D-Engine schnell lädt). Silhouetten leuchtender Riesenpilze mit
 * Lamellen-Schein, schwebende Sporen, langsames Pulsieren.
 * Bei `prefers-reduced-motion` oder schwachen Geräten: ein einzelnes Standbild.
 */
interface Spore { x: number; y: number; r: number; vx: number; vy: number; hue: number; ph: number }
interface Shroom { x: number; h: number; w: number; hue: number; lean: number; ph: number }
/** Lavalampen-Blase: steigt langsam vom unteren Rand auf, wabert, wird oben größer und blasser. */
interface Lava { x: number; y: number; r: number; vy: number; hue: number; ph: number; life: number }

export function startBackground(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2;
  const still = reduced || weak;
  let w = 0;
  let h = 0;
  let spores: Spore[] = [];
  let shrooms: Shroom[] = [];
  let raf = 0;
  let last = 0;
  let stars: { x: number; y: number; a: number }[] = [];
  let lava: Lava[] = [];
  const newLava = (fromBottom: boolean): Lava => ({
    x: rnd(0.05, 0.95) * w, y: fromBottom ? h + rnd(20, 120) : rnd(0.2, 1) * h, r: rnd(18, 70), vy: rnd(9, 22),
    hue: [320, 25, 172, 270][Math.floor(rnd(0, 4))], ph: rnd(0, 6.28), life: 0,
  });

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(110, (w * h) / 14000));
    spores = Array.from({ length: n }, () => ({ x: rnd(0, w), y: rnd(0, h), r: rnd(0.8, 2.6), vx: rnd(-6, 6), vy: rnd(-14, -3), hue: [170, 185, 275, 310, 95][Math.floor(rnd(0, 5))], ph: rnd(0, 6.28) }));
    const nS = Math.max(5, Math.round(w / 160));
    shrooms = Array.from({ length: nS }, (_, i) => ({
      x: ((i + rnd(0.1, 0.9)) / nS) * w, h: rnd(0.25, 0.62) * h, w: rnd(70, 190), hue: [175, 280, 320, 190][i % 4], lean: rnd(-0.12, 0.12), ph: rnd(0, 6.28),
    }));
    stars = Array.from({ length: Math.round((w * h) / 5000) }, () => ({ x: rnd(0, w), y: rnd(0, h * 0.6), a: rnd(0.2, 0.9) }));
    lava = Array.from({ length: Math.max(5, Math.round(w / 220)) }, () => newLava(false));
    if (still) draw(0);
  };

  const draw = (t: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#05030f');
    g.addColorStop(0.6, '#0d0624');
    g.addColorStop(1, '#03060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Nebel
    const neb = ctx.createRadialGradient(w * 0.7, h * 0.2, 0, w * 0.7, h * 0.2, w * 0.6);
    neb.addColorStop(0, 'rgba(120,40,170,0.25)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, w, h);
    for (const s of stars) {
      ctx.fillStyle = `rgba(220,230,255,${s.a * (0.7 + 0.3 * Math.sin(t * 0.001 + s.x))})`;
      ctx.fillRect(s.x, s.y, 1.2, 1.2);
    }
    // Gasriese
    const gx = w * 0.82, gy = h * 0.3, gr = Math.min(w, h) * 0.12;
    const gg = ctx.createRadialGradient(gx - gr * 0.3, gy - gr * 0.3, gr * 0.1, gx, gy, gr);
    gg.addColorStop(0, 'rgba(160,110,190,0.55)');
    gg.addColorStop(1, 'rgba(40,20,70,0.35)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI * 2);
    ctx.fill();
    // Lavalampen-Blasen (hinter den Pilzen): weiche, wabernde, milchig leuchtende Formen
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of lava) {
      const fade = Math.max(0, Math.min(1, b.y / (h * 0.35))) * Math.min(1, b.life / 2);
      const wob = Math.sin(t * 0.0009 + b.ph);
      const rx = b.r * (1 + 0.12 * wob);
      const ry = b.r * (1.15 - 0.12 * wob);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, Math.max(rx, ry));
      g.addColorStop(0, `hsla(${b.hue},100%,70%,${0.32 * fade})`);
      g.addColorStop(0.7, `hsla(${b.hue},100%,60%,${0.18 * fade})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, rx, ry, Math.sin(t * 0.0004 + b.ph) * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Pilze
    for (const m of shrooms) {
      const pulse = 0.65 + 0.35 * Math.sin(t * 0.0012 + m.ph);
      const baseY = h + 10;
      const topX = m.x + m.lean * m.h;
      const topY = baseY - m.h;
      ctx.strokeStyle = 'rgba(14,10,28,1)';
      ctx.lineWidth = m.w * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x, baseY);
      ctx.quadraticCurveTo(m.x + m.lean * m.h * 0.2, baseY - m.h * 0.5, topX, topY);
      ctx.stroke();
      // Lamellen-Schein unter dem Hut
      const glow = ctx.createRadialGradient(topX, topY + 4, 2, topX, topY + 4, m.w * 0.9);
      glow.addColorStop(0, `hsla(${m.hue},100%,65%,${0.55 * pulse})`);
      glow.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(topX, topY + 6, m.w * 0.9, m.w * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      // Lamellen
      ctx.strokeStyle = `hsla(${m.hue},100%,70%,${0.5 * pulse})`;
      ctx.lineWidth = 1;
      for (let k = -8; k <= 8; k++) {
        ctx.beginPath();
        ctx.moveTo(topX + k * m.w * 0.055, topY + 2);
        ctx.lineTo(topX + k * m.w * 0.02, topY + m.w * 0.1);
        ctx.stroke();
      }
      // Hut
      ctx.fillStyle = 'rgba(16,10,30,1)';
      ctx.beginPath();
      ctx.ellipse(topX, topY, m.w * 0.5, m.w * 0.2, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = `hsla(${m.hue},100%,70%,${0.7 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(topX, topY, m.w * 0.5, m.w * 0.2, 0, Math.PI, 0);
      ctx.stroke();
    }
    // Sporen
    for (const s of spores) {
      const a = 0.5 + 0.5 * Math.sin(t * 0.002 + s.ph);
      ctx.fillStyle = `hsla(${s.hue},100%,75%,${0.25 + 0.6 * a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (document.hidden || t - last < 33) return; // ≤ 30 FPS, pausiert im Hintergrund-Tab
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    for (let i = 0; i < lava.length; i++) {
      const b = lava[i];
      b.life += dt;
      b.y -= b.vy * dt;
      b.x += Math.sin(t * 0.0006 + b.ph) * 6 * dt;
      if (b.y < h * 0.4) b.r += dt * 4; // oben größer …
      if (b.y < -b.r) lava[i] = newLava(true); // … und dann aufgelöst
    }
    for (const s of spores) {
      s.x += (s.vx + Math.sin(t * 0.0007 + s.ph) * 4) * dt;
      s.y += s.vy * dt;
      if (s.y < -5) { s.y = h + 5; s.x = rnd(0, w); }
      if (s.x < -5) s.x = w + 5;
      if (s.x > w + 5) s.x = -5;
    }
    draw(t);
  };

  window.addEventListener('resize', resize);
  resize();
  if (!still) raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
