/**
 * Lavalampen-Blasen (reine Simulation, ohne Three.js → testbar).
 *
 * Lebenszyklus je Blase:
 *   forming  an einer Quelle wölbt sie sich langsam hervor (wächst, unten eingeschnürt)
 *   rising   löst sich (Ereignis 'detach'), steigt 0,2–0,6 m/s, taumelt seitlich, pulsiert,
 *            teilt sich gelegentlich ('split') oder verschmilzt mit einer anderen ('merge')
 *   fading   in großer Höhe größer und blasser, löst sich vor dem Himmel auf
 *
 * Sicherheit: Quellen nur außerhalb der Spielfläche; jede Blase hält zur Spielfläche (und damit zu
 * Brett und Spielerköpfen, die darin sind) mindestens 1,5 m + Radius Abstand; zusätzlich harte
 * Kopf-Sperrzone 1,5 m (Oberfläche) für den Fall, dass ein Kopf über die Boundary hinausragt.
 */

export interface LavaSource {
  x: number;
  y: number;
  z: number;
  /** maximaler Blasenradius an dieser Quelle */
  maxR: number;
  nextAt: number;
  busy: boolean;
}

export type LavaState = 'forming' | 'rising' | 'fading' | 'absorbed';

export interface LavaBlob {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  targetR: number;
  vy: number;
  phase: number;
  age: number;
  state: LavaState;
  /** Längsstreckung (1 = Kugel) */
  stretch: number;
  /** Einschnürung unten (1 = stark, beim Hervorquellen) */
  pinch: number;
  alpha: number;
  color: number;
  source: number;
  into?: number;
}

export interface LavaEvent {
  type: 'detach' | 'split' | 'merge';
  x: number;
  y: number;
  z: number;
  source: number;
}

export interface LavaEnv {
  /** Abstand eines Punkts außerhalb der Spielfläche (0 = innen) */
  distOutside(x: number, z: number): number;
  /** Mittelpunkt der Fläche (Richtung „nach außen“ zum Wegschieben) */
  center: { x: number; z: number };
  heads: { x: number; y: number; z: number }[];
}

export const LAVA_MIN_CLEARANCE = 1.5;

export class LavaSim {
  blobs: LavaBlob[] = [];
  private nextId = 1;
  private t = 0;

  constructor(public sources: LavaSource[], public maxBlobs: number, private rng: () => number) {}

  /** Radius, den eine Blase an dieser Stelle höchstens haben darf (Abstand zur Spielfläche). */
  static allowedRadius(env: LavaEnv, x: number, z: number): number {
    return env.distOutside(x, z) - LAVA_MIN_CLEARANCE;
  }

  private spawn(si: number): void {
    const s = this.sources[si];
    s.busy = true;
    const r = s.maxR * (0.6 + this.rng() * 0.4);
    this.blobs.push({
      id: this.nextId++, x: s.x, y: s.y, z: s.z, r: 0.02, targetR: r, vy: 0, phase: this.rng() * 6.28, age: 0,
      state: 'forming', stretch: 0.8, pinch: 1, alpha: 0, color: Math.floor(this.rng() * 4), source: si,
    });
  }

  step(dt: number, env: LavaEnv): LavaEvent[] {
    this.t += dt;
    const ev: LavaEvent[] = [];
    // neue Blasen an freien Quellen
    this.sources.forEach((s, i) => {
      if (!s.busy && this.t >= s.nextAt && this.blobs.length < this.maxBlobs) this.spawn(i);
    });
    const born: LavaBlob[] = [];
    for (const b of this.blobs) {
      b.age += dt;
      if (b.state === 'forming') {
        // hervorquellen: wachsen, Mittelpunkt hebt sich mit dem Radius, unten stark eingeschnürt
        b.r = Math.min(b.targetR, b.r + dt * b.targetR * 0.28);
        b.alpha = Math.min(1, b.alpha + dt * 0.6);
        const s = this.sources[b.source];
        b.y = s.y + b.r * 0.55;
        b.stretch = 0.85 + 0.35 * (b.r / b.targetR);
        b.pinch = 1;
        if (b.r >= b.targetR - 1e-4) {
          b.state = 'rising';
          b.vy = 0.05;
          s.busy = false;
          s.nextAt = this.t + 3 + this.rng() * 6;
          ev.push({ type: 'detach', x: b.x, y: s.y, z: b.z, source: b.source });
        }
      } else if (b.state === 'rising' || b.state === 'fading') {
        const target = 0.2 + 0.4 * ((b.phase * 13.7) % 1); // 0,2–0,6 m/s
        b.vy += (target - b.vy) * Math.min(1, dt * 0.5);
        b.y += b.vy * dt;
        // seitliches Taumeln
        b.x += Math.sin(this.t * 0.6 + b.phase) * 0.12 * dt;
        b.z += Math.cos(this.t * 0.47 + b.phase * 1.3) * 0.12 * dt;
        b.pinch = Math.max(0, b.pinch - dt * 0.8); // Einschnürung löst sich nach dem Abheben
        b.stretch = 1.0 + 0.5 * Math.min(1, b.vy / 0.6) + 0.06 * Math.sin(this.t * 1.7 + b.phase); // in die Länge, pulsierend
        if (b.y > 14 && b.state === 'rising') b.state = 'fading';
        if (b.state === 'fading') {
          b.r *= 1 + dt * 0.08;
          b.alpha -= dt * 0.12;
        }
        // gelegentliches Teilen
        if (b.state === 'rising' && b.r > 0.35 && b.y > 2 && this.rng() < dt * 0.02 && this.blobs.length + born.length < this.maxBlobs) {
          const nr = b.r * 0.794; // halbes Volumen je Teil
          b.r = nr;
          const a = this.rng() * Math.PI * 2;
          born.push({ ...b, id: this.nextId++, x: b.x + Math.cos(a) * nr * 1.1, z: b.z + Math.sin(a) * nr * 1.1, phase: b.phase + 1.7, vy: b.vy * 0.85 });
          b.x -= Math.cos(a) * nr * 0.4;
          b.z -= Math.sin(a) * nr * 0.4;
          ev.push({ type: 'split', x: b.x, y: b.y, z: b.z, source: b.source });
        }
      } else if (b.state === 'absorbed') {
        const into = this.blobs.find((o) => o.id === b.into);
        b.r *= 1 - Math.min(1, dt * 3);
        if (into) {
          b.x += (into.x - b.x) * Math.min(1, dt * 4);
          b.y += (into.y - b.y) * Math.min(1, dt * 4);
          b.z += (into.z - b.z) * Math.min(1, dt * 4);
        }
        if (b.r < 0.02) b.alpha = 0;
      }
    }
    this.blobs.push(...born);
    // Verschmelzen zweier aufsteigender Blasen
    for (let i = 0; i < this.blobs.length; i++) {
      const a = this.blobs[i];
      if (a.state !== 'rising') continue;
      for (let j = i + 1; j < this.blobs.length; j++) {
        const c = this.blobs[j];
        if (c.state !== 'rising') continue;
        const d = Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
        if (d < (a.r + c.r) * 0.55) {
          const [big, small] = a.r >= c.r ? [a, c] : [c, a];
          big.r = Math.cbrt(big.r ** 3 + small.r ** 3);
          small.state = 'absorbed';
          small.into = big.id;
          ev.push({ type: 'merge', x: big.x, y: big.y, z: big.z, source: big.source });
        }
      }
    }
    // Sicherheit: Abstand zur Spielfläche und zu Köpfen erzwingen (nach außen schieben)
    for (const b of this.blobs) this.enforce(b, env);
    // Aufräumen
    this.blobs = this.blobs.filter((b) => b.alpha > 0 && b.y < 30);
    return ev;
  }

  private enforce(b: LavaBlob, env: LavaEnv): void {
    for (let k = 0; k < 4; k++) {
      const need = LAVA_MIN_CLEARANCE + b.r;
      const d = env.distOutside(b.x, b.z);
      if (d >= need) break;
      let dx = b.x - env.center.x;
      let dz = b.z - env.center.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      b.x += dx * (need - d + 0.01);
      b.z += dz * (need - d + 0.01);
    }
    for (const h of env.heads) {
      const dx = b.x - h.x;
      const dy = b.y - h.y;
      const dz = b.z - h.z;
      const l = Math.hypot(dx, dy, dz);
      const need = LAVA_MIN_CLEARANCE + b.r;
      if (l < need) {
        const hl = Math.hypot(dx, dz) || 1;
        b.x += (dx / hl) * (need - l + 0.01);
        b.z += (dz / hl) * (need - l + 0.01);
      }
    }
  }
}
