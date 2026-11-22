/**
 * Reine Mix-Logik (testbar): Stimmen-Vergabe mit Priorität, Vorbeiflug-Bahnen am Kopf vorbei,
 * Doppler-Verlauf.
 */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface VoiceState {
  busyUntil: number;
  /** Abstand der Quelle zum Kopf beim Start (für die Priorität) */
  dist: number;
}

/**
 * Prioritätsgewicht je Klangart (wird mit dem Abstand multipliziert – kleiner = wichtiger):
 * nahe Insekten/Brummer zuerst, dann Blasen-Gluckern, dann Pflanzen/Tropfen, dann ferne Rufe.
 * Spiel-Sounds laufen über einen eigenen Bus und belegen keine Pool-Stimme (haben immer Vorrang).
 */
export const PRIORITY_WEIGHT: Record<string, number> = { flyby: 1, ground: 1, glug: 1.6, plant: 2, drip: 2, call: 3 };

/**
 * Welche Stimme bekommt ein neuer Klang? Freie Stimme, solange weniger als `maxActive` laufen;
 * sonst wird die am weitesten entfernte laufende Stimme übernommen – aber nur, wenn der neue Klang
 * näher ist (nahe Klänge haben Vorrang). −1 = verwerfen.
 */
export function chooseVoice(voices: VoiceState[], now: number, newDist: number, maxActive: number): number {
  const active = voices.filter((v) => v.busyUntil > now).length;
  if (active < maxActive) {
    const free = voices.findIndex((v) => v.busyUntil <= now);
    if (free >= 0) return free;
  }
  let far = -1;
  for (let i = 0; i < voices.length; i++) if (voices[i].busyUntil > now && (far < 0 || voices[i].dist > voices[far].dist)) far = i;
  return far >= 0 && voices[far].dist > newDist ? far : -1;
}

/**
 * Vorbeiflug: eine gerade Bahn von einer Seite zur anderen, die in `pass` Metern am Kopf vorbeiführt
 * (nie näher – reine Hörbahn, kein sichtbares Insekt). `rnd` ∈ [0,1)³ für Richtung/Höhe/Abstand.
 */
export function flybyPath(head: V3, fwd: V3, rnd: () => number, minPass = 0.8, maxPass = 1.4, halfLen = 3.5): { start: V3; end: V3; pass: number } {
  // horizontale Rechts-Achse aus der Blickrichtung
  const fl = Math.hypot(fwd.x, fwd.z) || 1;
  const f = { x: fwd.x / fl, z: fwd.z / fl };
  const right = { x: -f.z, z: f.x };
  const pass = minPass + (maxPass - minPass) * rnd();
  const side = rnd() < 0.5 ? -1 : 1; // vor oder hinter dem Kopf vorbei
  const dir = rnd() < 0.5 ? -1 : 1; // links→rechts oder rechts→links
  const dy = (rnd() - 0.5) * 0.6;
  const cx = head.x + f.x * pass * side;
  const cz = head.z + f.z * pass * side;
  return {
    start: { x: cx - right.x * halfLen * dir, y: head.y + dy, z: cz - right.z * halfLen * dir },
    end: { x: cx + right.x * halfLen * dir, y: head.y + dy * 0.5, z: cz + right.z * halfLen * dir },
    pass,
  };
}

export function lerp3(a: V3, b: V3, t: number): V3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Kleinster Abstand der Bahn zum Kopf (Prüfung: nie unter dem Mindestabstand). */
export function pathMinDistance(start: V3, end: V3, head: V3, steps = 200): number {
  let m = Infinity;
  for (let i = 0; i <= steps; i++) {
    const p = lerp3(start, end, i / steps);
    m = Math.min(m, Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z));
  }
  return m;
}

/**
 * Doppler-Verlauf in Cent über die Dauer (leicht übertrieben, `gain`), Schallgeschwindigkeit 343 m/s.
 * Annäherung → höher, Entfernung → tiefer.
 */
export function dopplerCents(start: V3, end: V3, head: V3, dur: number, n = 24, gain = 4): Float32Array {
  const out = new Float32Array(n);
  const v = { x: (end.x - start.x) / dur, y: (end.y - start.y) / dur, z: (end.z - start.z) / dur };
  for (let i = 0; i < n; i++) {
    const p = lerp3(start, end, i / (n - 1));
    const d = { x: head.x - p.x, y: head.y - p.y, z: head.z - p.z };
    const l = Math.hypot(d.x, d.y, d.z) || 1;
    const vr = (v.x * d.x + v.y * d.y + v.z * d.z) / l; // > 0: nähert sich
    const ratio = 343 / Math.max(50, 343 - vr * gain);
    out[i] = 1200 * Math.log2(ratio);
  }
  return out;
}
