/**
 * Verhalten der Insekten (reine Mathematik, ohne Three.js → testbar).
 *
 *  Glühwürmchen  langsames Wandern/Schweben, vereinzelt hoch über dem Brett
 *  Mücken        Boids-Schwärme über dem Nebel am Wall
 *  Motten        kreisen um leuchtende Pilzhüte (Lichtanziehung)
 *  Libellen      schnelle Sprints zwischen Punkten am Hang, dazwischen Schweben
 *
 * Sicherheitsregeln (in dieser Reihenfolge am Ende jedes Schritts erzwungen):
 *  1. nie unter den Boden
 *  2. nie in den Raum über dem Brett (Figuren/Griffpunkte bleiben frei);
 *     Glühwürmchen dürfen nur in sicherer Höhe darüber
 *  3. HART: nie näher als `minHeadDist` (0,6 m) am Kopf; weiche Ausweichzone davor,
 *     und nichts fliegt direkt vor die Augen (Sichtkegel)
 */

export type InsectKind = 'firefly' | 'midge' | 'moth' | 'dragonfly';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Agent {
  kind: InsectKind;
  p: V3;
  v: V3;
  target: V3;
  timer: number;
  swarm: number;
  attractor: number;
  phase: number;
  /** >0: sitzt (Landung auf der Hand) noch so viele Sekunden */
  landed: number;
}

export interface InsectEnv {
  head: V3;
  headFwd: V3;
  minHeadDist: number;
  softHeadDist: number;
  groundAt(x: number, z: number): number;
  /** Zufälliger Punkt am Hang/Wall in Flughöhe. */
  wallPoint(rng: () => number, minH: number, maxH: number): V3;
  center: V3;
  maxRadius: number;
  boardHalf: number;
  pieceTop: number;
  /** Lage des Bretts (VR: verschoben/gedreht/auf Tischhöhe). Fehlt sie: Brett in `center`, achsparallel. */
  board?: { x: number; z: number; yaw: number; baseY: number };
  attractors: V3[];
  swarmCenters: V3[];
  /** Ruhig gehaltene Hand (Easter Egg) oder null. */
  landing: V3 | null;
}

export const MIN_HEAD_DIST = 0.6;
export const SPEED: Record<InsectKind, number> = { firefly: 0.35, midge: 0.9, moth: 0.8, dragonfly: 3.2 };

const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const addS = (a: V3, b: V3, s: number) => {
  a.x += b.x * s;
  a.y += b.y * s;
  a.z += b.z * s;
};

/** Mindestabstand zum Kopf erzwingen (Position auf die Kugel schieben, Geschwindigkeit nach außen). */
export function enforceHeadClearance(p: V3, v: V3, head: V3, min: number): void {
  const d = sub(p, head);
  let l = len(d);
  if (l >= min) return;
  if (l < 1e-6) {
    d.x = 0;
    d.y = 1;
    d.z = 0;
    l = 1;
  }
  const n = { x: d.x / l, y: d.y / l, z: d.z / l };
  p.x = head.x + n.x * (min + 1e-3);
  p.y = head.y + n.y * (min + 1e-3);
  p.z = head.z + n.z * (min + 1e-3);
  const vn = v.x * n.x + v.y * n.y + v.z * n.z;
  if (vn < 0) addS(v, n, -vn * 1.6); // nach außen umlenken
}

/** Darf diese Art über dem Brett sein (in welcher Mindesthöhe)? */
export function boardCeiling(kind: InsectKind, env: Pick<InsectEnv, 'pieceTop' | 'board'>): number {
  return kind === 'firefly' ? (env.board?.baseY ?? 0) + env.pieceTop + 0.6 : Infinity;
}

/** Punkt → Brett-Koordinaten (Ursprung Brettmitte, Achsen entlang der Brettkanten). */
function toBoard(env: InsectEnv, x: number, z: number): { bx: number; bz: number } {
  const b = env.board ?? { x: env.center.x, z: env.center.z, yaw: 0, baseY: 0 };
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { bx: dx * c - dz * s, bz: dx * s + dz * c };
}

function fromBoard(env: InsectEnv, bx: number, bz: number): { x: number; z: number } {
  const b = env.board ?? { x: env.center.x, z: env.center.z, yaw: 0, baseY: 0 };
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + bx * c + bz * s, z: b.z - bx * s + bz * c };
}

export function createAgents(counts: Record<InsectKind, number>, env: InsectEnv, rng: () => number): Agent[] {
  const out: Agent[] = [];
  const mk = (kind: InsectKind, i: number): Agent => {
    const p = env.wallPoint(rng, kind === 'midge' ? 0.5 : 0.4, kind === 'firefly' ? 2.6 : 2.0);
    return { kind, p, v: { x: 0, y: 0, z: 0 }, target: { ...p }, timer: rng() * 3, swarm: i % Math.max(1, env.swarmCenters.length), attractor: env.attractors.length ? Math.floor(rng() * env.attractors.length) : -1, phase: rng() * Math.PI * 2, landed: 0 };
  };
  for (const kind of Object.keys(counts) as InsectKind[]) for (let i = 0; i < counts[kind]; i++) out.push(mk(kind, i));
  return out;
}

export function stepAgents(agents: Agent[], env: InsectEnv, dt: number, rng: () => number, time: number): void {
  // Schwarmzentren driften langsam am Wall entlang
  env.swarmCenters.forEach((c, i) => {
    const a = time * 0.03 + i * 2.1;
    c.x += Math.cos(a) * 0.08 * dt;
    c.z += Math.sin(a) * 0.08 * dt;
    c.y = env.groundAt(c.x, c.z) + 0.8 + 0.2 * Math.sin(time * 0.4 + i);
  });

  const acc: V3 = { x: 0, y: 0, z: 0 };
  agents.forEach((a, idx) => {
    acc.x = acc.y = acc.z = 0;
    if (a.landed > 0) {
      a.landed -= dt;
      a.v.x = a.v.y = a.v.z = 0;
      if (env.landing && a.landed > 0) {
        a.p = { ...env.landing };
        enforceHeadClearance(a.p, a.v, env.head, env.minHeadDist);
        return;
      }
      a.landed = 0;
      a.target = env.wallPoint(rng, 0.6, 2.2);
    }
    a.timer -= dt;
    switch (a.kind) {
      case 'firefly': {
        if (idx === 0 && env.landing) a.target = env.landing;
        else if (a.timer <= 0) {
          // jedes fünfte Glühwürmchen schwebt gelegentlich hoch über das Brett
          a.target = idx % 5 === 0 && rng() < 0.3
            ? { ...fromBoard(env, (rng() - 0.5) * env.boardHalf, (rng() - 0.5) * env.boardHalf), y: boardCeiling('firefly', env) + 0.2 + rng() * 0.6 }
            : env.wallPoint(rng, 0.4, 2.6);
          a.timer = 4 + rng() * 6;
        }
        const d = sub(a.target, a.p);
        addS(acc, d, 0.4);
        acc.y += Math.sin(time * 1.3 + a.phase) * 0.15;
        if (idx === 0 && env.landing && len(sub(env.landing, a.p)) < 0.03) a.landed = 4;
        break;
      }
      case 'midge': {
        const c = env.swarmCenters[a.swarm] ?? env.center;
        addS(acc, sub(c, a.p), 2.0); // Kohäsion
        // Separation/Alignment nur innerhalb des eigenen Schwarms (kleine Gruppen → O(n²) unkritisch)
        for (let j = 0; j < agents.length; j++) {
          const b = agents[j];
          if (b === a || b.kind !== 'midge' || b.swarm !== a.swarm) continue;
          const d = sub(a.p, b.p);
          const l = len(d);
          if (l < 0.12 && l > 1e-5) addS(acc, d, 0.6 / (l * l + 0.01));
          if (l < 0.4) addS(acc, sub(b.v, a.v), 0.05);
        }
        acc.x += (rng() - 0.5) * 6;
        acc.y += (rng() - 0.5) * 6;
        acc.z += (rng() - 0.5) * 6;
        break;
      }
      case 'moth': {
        const at = a.attractor >= 0 ? env.attractors[a.attractor] : null;
        if (at) {
          const r = 0.35 + 0.25 * Math.sin(a.phase * 3);
          const w = time * (1.2 + (a.phase % 1)) + a.phase;
          const goal = { x: at.x + Math.cos(w) * r, y: at.y + 0.1 + Math.sin(w * 1.7) * 0.12, z: at.z + Math.sin(w) * r };
          addS(acc, sub(goal, a.p), 4);
          if (a.timer <= 0) {
            if (rng() < 0.25 && env.attractors.length) a.attractor = Math.floor(rng() * env.attractors.length);
            a.timer = 6 + rng() * 10;
          }
        } else addS(acc, sub(env.wallPoint(rng, 0.5, 2), a.p), 0.3);
        acc.x += (rng() - 0.5) * 3;
        acc.z += (rng() - 0.5) * 3;
        break;
      }
      case 'dragonfly': {
        const d = sub(a.target, a.p);
        const l = len(d);
        if (a.timer <= 0 || l < 0.15) {
          if (a.timer <= 0) {
            a.target = env.wallPoint(rng, 0.8, 2.4);
            a.timer = 1.5 + rng() * 3.5;
          }
          // Schweben: stark abbremsen
          addS(acc, a.v, -4);
        } else addS(acc, d, 6 / Math.max(0.3, l));
        acc.y += Math.sin(time * 6 + a.phase) * 0.4;
        break;
      }
    }

    // Weich: Kopfzone und Sichtkegel meiden
    const toHead = sub(a.p, env.head);
    const hd = len(toHead);
    if (hd < env.softHeadDist && hd > 1e-6) addS(acc, toHead, (6 * (env.softHeadDist - hd)) / hd);
    if (hd < 1.6 && hd > 1e-6) {
      const cos = (toHead.x * env.headFwd.x + toHead.y * env.headFwd.y + toHead.z * env.headFwd.z) / hd;
      if (cos > 0.85) {
        // seitlich aus dem Blickfeld drängen
        const side = { x: env.headFwd.z, y: 0, z: -env.headFwd.x };
        const sgn = side.x * toHead.x + side.z * toHead.z >= 0 ? 1 : -1;
        addS(acc, side, 3 * sgn);
      }
    }
    // Nicht zu weit wegfliegen
    const fromC = sub(a.p, env.center);
    const rc = Math.hypot(fromC.x, fromC.z);
    if (rc > env.maxRadius) {
      acc.x -= (fromC.x / rc) * 2;
      acc.z -= (fromC.z / rc) * 2;
    }

    addS(a.v, acc, dt);
    const maxV = SPEED[a.kind];
    const sp = len(a.v);
    if (sp > maxV) {
      a.v.x *= maxV / sp;
      a.v.y *= maxV / sp;
      a.v.z *= maxV / sp;
    }
    addS(a.p, a.v, dt);

    // 1. Boden
    const g = env.groundAt(a.p.x, a.p.z) + 0.15;
    if (a.p.y < g) {
      a.p.y = g;
      if (a.v.y < 0) a.v.y *= -0.3;
    }
    // 2. Brettraum
    const { bx, bz } = toBoard(env, a.p.x, a.p.z);
    if (Math.abs(bx) < env.boardHalf && Math.abs(bz) < env.boardHalf) {
      const ceil = boardCeiling(a.kind, env);
      if (Number.isFinite(ceil)) {
        if (a.p.y < ceil) {
          a.p.y = ceil;
          if (a.v.y < 0) a.v.y = 0;
        }
      } else {
        // zur nächsten Brettkante hinausschieben
        // Nicht-Glühwürmchen nie über dem Brett (in keiner Höhe) → seitlich hinausschieben
        {
          const out = env.boardHalf - Math.abs(bx) < env.boardHalf - Math.abs(bz)
            ? fromBoard(env, Math.sign(bx || 1) * env.boardHalf, bz)
            : fromBoard(env, bx, Math.sign(bz || 1) * env.boardHalf);
          const nx = out.x - a.p.x;
          const nz = out.z - a.p.z;
          a.p.x = out.x;
          a.p.z = out.z;
          const nl = Math.hypot(nx, nz) || 1;
          const vn = (a.v.x * nx + a.v.z * nz) / nl;
          if (vn < 0) {
            a.v.x -= (nx / nl) * vn * 2;
            a.v.z -= (nz / nl) * vn * 2;
          }
        }
        if (a.kind === 'dragonfly' || a.kind === 'firefly') a.timer = 0;
      }
    }
    // 3. HART: Mindestabstand zum Kopf (immer zuletzt)
    enforceHeadClearance(a.p, a.v, env.head, env.minHeadDist);
  });
}
