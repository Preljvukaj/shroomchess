import { describe, expect, it } from 'vitest';
import { createBasin, squarePolygon } from '../src/render/world/basin';
import { LAVA_MIN_CLEARANCE, LavaSim } from '../src/render/world/lavaSim';
import { createLavaSources } from '../src/render/world/lavaBubbles';
import { footprintMin } from '../src/render/world/vegetation';
import { pointInPolygon } from '../src/xr/math/vec2';

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const lShape = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 }];

describe('Lavalampen-Blasen', () => {
  for (const [name, pts] of Object.entries({ quadrat: squarePolygon(3), lForm: lShape })) {
    it(`${name}: Quellen außerhalb der Spielfläche, mit Bodenkontakt (3 cm)`, () => {
      const b = createBasin({ pts });
      const src = createLavaSources(b, 16, lcg(3));
      expect(src.length).toBeGreaterThanOrEqual(8);
      for (const s of src) {
        expect(pointInPolygon({ x: s.x, z: s.z }, pts)).toBe(false);
        expect(b.distOutside(s.x, s.z)).toBeGreaterThanOrEqual(LAVA_MIN_CLEARANCE + s.maxR - 1e-6);
        expect(Math.abs(s.y - footprintMin(b, s.x, s.z, 0))).toBeLessThanOrEqual(0.03);
      }
    });

    it(`${name}: keine Blasenbahn in der Spielfläche oder in Kopfnähe (lange Simulation)`, () => {
      const b = createBasin({ pts });
      const rng = lcg(9);
      const sim = new LavaSim(createLavaSources(b, 16, rng), 20, rng);
      // Köpfe laufen in der Fläche umher, auch direkt an der Boundary
      const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
      let events = 0, maxSeen = 0, minHead = Infinity, minRegion = Infinity;
      for (let i = 0; i < 6000; i++) {
        const t = i / 30;
        let hx = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * (0.5 + 0.5 * Math.sin(t * 0.37 + i * 0.01));
        let hz = Math.min(...zs) + (Math.max(...zs) - Math.min(...zs)) * (0.5 + 0.5 * Math.cos(t * 0.29));
        if (!pointInPolygon({ x: hx, z: hz }, pts)) {
          hx = 1;
          hz = 1;
        }
        const heads = [{ x: hx, y: 1.6, z: hz }];
        const ev = sim.step(1 / 30, { distOutside: (x, z) => b.distOutside(x, z), center: b.center, heads });
        events += ev.length;
        maxSeen = Math.max(maxSeen, sim.blobs.length);
        for (const bl of sim.blobs) {
          if (bl.state === 'absorbed') continue;
          // Oberfläche der Blase nie in der Fläche bzw. weniger als 1,5 m davon entfernt
          minRegion = Math.min(minRegion, b.distOutside(bl.x, bl.z) - bl.r);
          if (pointInPolygon({ x: hx, z: hz }, pts)) minHead = Math.min(minHead, Math.hypot(bl.x - hx, bl.y - 1.6, bl.z - hz) - bl.r);
        }
      }
      expect(minRegion).toBeGreaterThanOrEqual(LAVA_MIN_CLEARANCE - 1e-3);
      expect(minHead).toBeGreaterThanOrEqual(LAVA_MIN_CLEARANCE - 1e-3);
      expect(events).toBeGreaterThan(10); // Ablösen/Teilen/Verschmelzen passiert
      expect(maxSeen).toBeGreaterThanOrEqual(8);
      expect(maxSeen).toBeLessThanOrEqual(20);
    });
  }

  it('Lebenszyklus: hervorquellen → ablösen → steigen (0,2–0,6 m/s) → verblassen', () => {
    const b = createBasin({ pts: squarePolygon(3) });
    const rng = lcg(1);
    const sim = new LavaSim([{ x: 8, y: b.heightAt(8, 0), z: 0, maxR: 0.6, nextAt: 0, busy: false }], 4, rng);
    const env = { distOutside: (x: number, z: number) => b.distOutside(x, z), center: b.center, heads: [] };
    const types: string[] = [];
    let maxVy = 0;
    for (let i = 0; i < 30 * 120; i++) {
      for (const e of sim.step(1 / 30, env)) types.push(e.type);
      for (const bl of sim.blobs) if (bl.state === 'rising') maxVy = Math.max(maxVy, bl.vy);
    }
    expect(types).toContain('detach');
    expect(maxVy).toBeGreaterThan(0.15);
    expect(maxVy).toBeLessThanOrEqual(0.6 + 1e-6);
  });
});
