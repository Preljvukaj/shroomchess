/**
 * Asteroiden, Kometen und Sternschnuppen am Himmel – reine Planung (testbar, ohne Three.js).
 * Alles lebt auf der Himmelskugel (Richtungen, unendlich weit): Bahnen sind Großkreisbögen.
 *
 * Regeln: nur im oberen Himmel (Elevation ≥ MIN_ELEV, also nie im zentralen Blickfeld über dem Brett, das unter
 * dem Horizont liegt), nie durch Monde oder Gasriese, höchstens MAX_ACTIVE Objekte gleichzeitig (Pool).
 */

export type V3 = { x: number; y: number; z: number };

export interface SkyBody {
  dir: V3;
  r: number;
}

export interface AsteroidConfig {
  /** Sekunden zwischen großen Asteroiden bzw. Gruppen */
  bigEvery: [number, number];
  cometEvery: [number, number];
  meteorEvery: [number, number];
  /** Dauer eines Überflugs */
  bigDuration: [number, number];
  cometDuration: [number, number];
  meteorDuration: [number, number];
  /** Wahrscheinlichkeit, dass statt eines Asteroiden ein kleines Trümmerfeld kommt */
  groupChance: number;
}

export const DEFAULT_ASTEROIDS: AsteroidConfig = {
  bigEvery: [45, 120],
  cometEvery: [180, 360],
  meteorEvery: [10, 30],
  bigDuration: [30, 90],
  cometDuration: [40, 80],
  meteorDuration: [0.35, 0.8],
  groupChance: 0.3,
};

export const MIN_ELEV = (25 * Math.PI) / 180;
export const MAX_ACTIVE = 8;
const BODY_MARGIN = 0.06;

export type SkyKind = 'asteroid' | 'comet' | 'meteor';

export interface SkyObject {
  id: number;
  kind: SkyKind;
  from: V3;
  to: V3;
  start: number;
  duration: number;
  /** Winkelgröße (rad) */
  size: number;
  spin: number;
  seed: number;
  /** Komet: Farbe 0 Türkis, 1 Violett, 2 Orange */
  hue: number;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Punkt auf dem Großkreisbogen (Slerp) */
export function slerpDir(a: V3, b: V3, t: number): V3 {
  const d = Math.min(1, Math.max(-1, dot(a, b)));
  const om = Math.acos(d);
  if (om < 1e-5) return a;
  const s = Math.sin(om);
  const k0 = Math.sin((1 - t) * om) / s;
  const k1 = Math.sin(t * om) / s;
  return norm({ x: a.x * k0 + b.x * k1, y: a.y * k0 + b.y * k1, z: a.z * k0 + b.z * k1 });
}

export function positionOf(o: SkyObject, time: number): V3 | null {
  const t = (time - o.start) / o.duration;
  if (t < 0 || t > 1) return null;
  return slerpDir(o.from, o.to, t);
}

/** Erfüllt eine Bahn alle Regeln? (Elevation, Abstand zu Himmelskörpern, inkl. Objektgröße) */
export function pathOk(from: V3, to: V3, size: number, bodies: SkyBody[]): boolean {
  for (let i = 0; i <= 24; i++) {
    const p = slerpDir(from, to, i / 24);
    if (Math.asin(p.y) < MIN_ELEV + size) return false;
    for (const b of bodies) if (Math.acos(Math.min(1, dot(p, b.dir))) < b.r + size + BODY_MARGIN) return false;
  }
  return true;
}

function randomDir(rng: () => number, elevMin: number, elevMax: number): V3 {
  const az = rng() * Math.PI * 2;
  const el = elevMin + rng() * (elevMax - elevMin);
  return { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
}

export class AsteroidSky {
  objects: SkyObject[] = [];
  private next: Record<SkyKind, number>;
  private id = 1;
  private time = 0;

  constructor(private rng: () => number, private bodies: SkyBody[], public cfg: AsteroidConfig = DEFAULT_ASTEROIDS) {
    const r = (a: [number, number]) => a[0] + rng() * (a[1] - a[0]);
    // erster Auftritt etwas früher, damit man nicht minutenlang wartet
    this.next = { asteroid: r(cfg.bigEvery) * 0.4, comet: r(cfg.cometEvery) * 0.5, meteor: r(cfg.meteorEvery) * 0.5 };
  }

  private span(a: [number, number]): number {
    return a[0] + this.rng() * (a[1] - a[0]);
  }

  /** Bahn suchen (mehrere Versuche); Bogenlänge passend zur Art */
  private makePath(kind: SkyKind, size: number): { from: V3; to: V3 } | null {
    const arc = kind === 'meteor' ? [0.08, 0.2] : kind === 'comet' ? [0.7, 1.2] : [0.6, 1.3];
    for (let k = 0; k < 40; k++) {
      const from = randomDir(this.rng, MIN_ELEV + size + 0.02, Math.PI / 2 - 0.15);
      // Ziel: in zufälliger Richtung um den gewünschten Bogen versetzt
      const len = arc[0] + this.rng() * (arc[1] - arc[0]);
      const az = this.rng() * Math.PI * 2;
      const up = Math.abs(from.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      const t1 = norm({ x: up.y * from.z - up.z * from.y, y: up.z * from.x - up.x * from.z, z: up.x * from.y - up.y * from.x });
      const t2 = { x: from.y * t1.z - from.z * t1.y, y: from.z * t1.x - from.x * t1.z, z: from.x * t1.y - from.y * t1.x };
      const dirT = { x: t1.x * Math.cos(az) + t2.x * Math.sin(az), y: t1.y * Math.cos(az) + t2.y * Math.sin(az), z: t1.z * Math.cos(az) + t2.z * Math.sin(az) };
      const to = norm({ x: from.x * Math.cos(len) + dirT.x * Math.sin(len), y: from.y * Math.cos(len) + dirT.y * Math.sin(len), z: from.z * Math.cos(len) + dirT.z * Math.sin(len) });
      if (pathOk(from, to, size, this.bodies)) return { from, to };
    }
    return null;
  }

  private spawn(kind: SkyKind, delay = 0): void {
    if (this.objects.length >= MAX_ACTIVE) return;
    const size = kind === 'asteroid' ? 0.012 + this.rng() * 0.03 : kind === 'comet' ? 0.012 : 0.004;
    const path = this.makePath(kind, kind === 'comet' ? 0.08 : size);
    if (!path) return;
    const duration = this.span(kind === 'asteroid' ? this.cfg.bigDuration : kind === 'comet' ? this.cfg.cometDuration : this.cfg.meteorDuration);
    this.objects.push({ id: this.id++, kind, ...path, start: this.time + delay, duration, size, spin: (this.rng() - 0.5) * 0.4, seed: this.rng(), hue: Math.floor(this.rng() * 3) });
  }

  step(dt: number): void {
    this.time += dt;
    this.objects = this.objects.filter((o) => this.time < o.start + o.duration);
    for (const kind of ['asteroid', 'comet', 'meteor'] as SkyKind[]) {
      if (this.time < this.next[kind]) continue;
      const every = kind === 'asteroid' ? this.cfg.bigEvery : kind === 'comet' ? this.cfg.cometEvery : this.cfg.meteorEvery;
      this.next[kind] = this.time + this.span(every);
      if (kind === 'asteroid' && this.rng() < this.cfg.groupChance) {
        // kleines Trümmerfeld: 2–4 Brocken auf nahezu paralleler Bahn, leicht versetzt
        const base = this.makePath('asteroid', 0.05);
        if (!base) continue;
        const n = 2 + Math.floor(this.rng() * 3);
        const duration = this.span(this.cfg.bigDuration);
        for (let i = 0; i < n && this.objects.length < MAX_ACTIVE; i++) {
          const off = (v: V3) => norm({ x: v.x + (this.rng() - 0.5) * 0.06, y: v.y + (this.rng() - 0.5) * 0.04, z: v.z + (this.rng() - 0.5) * 0.06 });
          const from = off(base.from);
          const to = off(base.to);
          const size = 0.008 + this.rng() * 0.018;
          if (!pathOk(from, to, size, this.bodies)) continue;
          this.objects.push({ id: this.id++, kind: 'asteroid', from, to, start: this.time + i * 1.5, duration: duration * (0.95 + this.rng() * 0.1), size, spin: (this.rng() - 0.5) * 0.5, seed: this.rng(), hue: 0 });
        }
      } else this.spawn(kind);
    }
  }

  get now(): number {
    return this.time;
  }
}
