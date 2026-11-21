import { describe, expect, it } from 'vitest';
import { type InsectEnv, MIN_HEAD_DIST, type V3, createAgents, enforceHeadClearance, stepAgents } from '../src/render/world/insectBrain';

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function makeEnv(rng: () => number, head: V3): InsectEnv {
  return {
    head,
    headFwd: { x: 0, y: 0, z: -1 },
    minHeadDist: MIN_HEAD_DIST,
    softHeadDist: 1.3,
    groundAt: (x, z) => Math.max(0, Math.hypot(x, z) - 4) * 0.6,
    wallPoint: (r, minH, maxH) => {
      const a = r() * Math.PI * 2;
      const d = 4.2 + r() * 3;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      return { x, y: Math.max(0, d - 4) * 0.6 + minH + r() * (maxH - minH), z };
    },
    center: { x: 0, y: 0, z: 0 },
    maxRadius: 9,
    boardHalf: 2.4,
    pieceTop: 1.25,
    attractors: [{ x: 4.5, y: 1.5, z: 0 }, { x: -4.6, y: 1.2, z: 1 }, { x: 0, y: 2, z: 5 }],
    swarmCenters: [{ x: 4.5, y: 1, z: 2 }, { x: -4.5, y: 1, z: -2 }],
    landing: null,
    ...{ rng },
  };
}

describe('Insekten: Mindestabstand zum Kopf', () => {
  it('enforceHeadClearance schiebt jeden Punkt auf ≥ 0,6 m', () => {
    const rng = lcg(1);
    const head = { x: 0.3, y: 1.6, z: 2.1 };
    for (let i = 0; i < 5000; i++) {
      const p = { x: head.x + (rng() - 0.5) * 1.4, y: head.y + (rng() - 0.5) * 1.4, z: head.z + (rng() - 0.5) * 1.4 };
      const v = { x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 };
      enforceHeadClearance(p, v, head, MIN_HEAD_DIST);
      expect(Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z)).toBeGreaterThanOrEqual(MIN_HEAD_DIST);
    }
    // exakt im Kopfmittelpunkt
    const p = { ...head };
    enforceHeadClearance(p, { x: 0, y: 0, z: 0 }, head, MIN_HEAD_DIST);
    expect(Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z)).toBeGreaterThanOrEqual(MIN_HEAD_DIST);
  });

  it('Simulation: kein Insekt kommt je näher als 0,6 m – auch wenn der Spieler herumläuft und eine Hand hinhält', () => {
    const rng = lcg(7);
    const head: V3 = { x: 0, y: 1.65, z: 2.8 };
    const env = makeEnv(rng, head);
    const agents = createAgents({ firefly: 40, midge: 50, moth: 30, dragonfly: 20 }, env, rng);
    let minD = Infinity;
    for (let step = 0; step < 3000; step++) {
      const t = step / 60;
      // Spieler läuft um das Brett, auch nah an den Wall und zum Schwarm
      head.x = Math.cos(t * 0.4) * 3.2;
      head.z = Math.sin(t * 0.4) * 3.2;
      head.y = 1.4 + 0.3 * Math.sin(t);
      env.headFwd = { x: -Math.sin(t * 0.4), y: 0, z: Math.cos(t * 0.4) };
      env.landing = step % 600 < 300 ? { x: head.x + 0.4, y: head.y - 0.3, z: head.z } : null; // Hand nah am Kopf
      stepAgents(agents, env, 1 / 60, rng, t);
      for (const a of agents) minD = Math.min(minD, Math.hypot(a.p.x - head.x, a.p.y - head.y, a.p.z - head.z));
    }
    expect(minD).toBeGreaterThanOrEqual(MIN_HEAD_DIST);
  });

  it('nur Glühwürmchen über dem Brett, und dann in sicherer Höhe', () => {
    const rng = lcg(3);
    const env = makeEnv(rng, { x: 0, y: 1.65, z: 8 });
    const agents = createAgents({ firefly: 50, midge: 30, moth: 20, dragonfly: 20 }, env, rng);
    for (let step = 0; step < 2000; step++) {
      stepAgents(agents, env, 1 / 60, rng, step / 60);
      for (const a of agents) {
        const over = Math.abs(a.p.x) < env.boardHalf && Math.abs(a.p.z) < env.boardHalf;
        if (!over) continue;
        expect(a.kind).toBe('firefly');
        expect(a.p.y).toBeGreaterThanOrEqual(env.pieceTop + 0.6 - 1e-9);
      }
    }
  });

  it('VR: verschobenes, gedrehtes Brett – trotzdem nur Glühwürmchen darüber', () => {
    const rng = lcg(11);
    const env = makeEnv(rng, { x: 0, y: 1.65, z: 8 });
    env.board = { x: 0.8, z: -0.6, yaw: 0.6, baseY: 0 };
    env.boardHalf = 1.6;
    const agents = createAgents({ firefly: 30, midge: 30, moth: 20, dragonfly: 20 }, env, rng);
    for (let step = 0; step < 1500; step++) {
      stepAgents(agents, env, 1 / 60, rng, step / 60);
      for (const a of agents) {
        const dx = a.p.x - 0.8;
        const dz = a.p.z + 0.6;
        const bx = dx * Math.cos(0.6) - dz * Math.sin(0.6);
        const bz = dx * Math.sin(0.6) + dz * Math.cos(0.6);
        if (Math.abs(bx) < env.boardHalf - 1e-6 && Math.abs(bz) < env.boardHalf - 1e-6) {
          expect(a.kind).toBe('firefly');
          expect(a.p.y).toBeGreaterThanOrEqual(env.pieceTop + 0.6 - 1e-9);
        }
      }
    }
  });
});
