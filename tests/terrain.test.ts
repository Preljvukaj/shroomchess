import { describe, expect, it } from 'vitest';
import { MIN_RIM_START, buildTerrainGrid, createBasin, squarePolygon } from '../src/render/world/basin';
import { fitBoard } from '../src/xr/math/boardFit';
import { pointInPolygon } from '../src/xr/math/vec2';

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const regions = {
  desktop: squarePolygon(3),
  kleinerRaum: squarePolygon(1.1),
  großerRaum: squarePolygon(5),
  lForm: [
    { x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 },
  ],
  gedreht: squarePolygon(2.4).map((p) => ({ x: p.x * Math.cos(0.5) - p.z * Math.sin(0.5) + 1.3, z: p.x * Math.sin(0.5) + p.z * Math.cos(0.5) - 0.7 })),
};

describe('Senke: begehbarer Bereich bleibt flach (Sicherheit)', () => {
  for (const [name, pts] of Object.entries(regions)) {
    it(`${name}: kein Geländepunkt innerhalb der Boundary (+0,5 m) über y = 0`, () => {
      const b = createBasin({ pts });
      const rnd = lcg(42);
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      const [x0, x1, z0, z1] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...zs) - 1, Math.max(...zs) + 1];
      let checked = 0;
      for (let i = 0; i < 20000; i++) {
        const x = x0 + (x1 - x0) * rnd();
        const z = z0 + (z1 - z0) * rnd();
        if (b.distOutside(x, z) <= MIN_RIM_START) {
          expect(b.heightAt(x, z)).toBe(0);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1000);
    });

    it(`${name}: auch das Render-Gitter ist innerhalb der Boundary exakt flach`, () => {
      const b = createBasin({ pts });
      const { positions } = buildTerrainGrid(b);
      let inside = 0;
      for (let i = 0; i < positions.length; i += 3) {
        const p = { x: positions[i], z: positions[i + 2] };
        if (pointInPolygon(p, pts) || b.distOutside(p.x, p.z) <= MIN_RIM_START) {
          expect(positions[i + 1]).toBe(0);
          inside++;
        }
      }
      expect(inside).toBeGreaterThan(0);
    });
  }

  it('Wall steigt außerhalb auf 1,2–1,8 m an und ist unregelmäßig', () => {
    const b = createBasin({ pts: regions.desktop });
    const heights: number[] = [];
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const d = b.rimDistance(t) + 0.01;
      // Punkt im Abstand d außerhalb, entlang des Strahls ab dem Polygonrand
      let r = 0;
      while (b.distOutside(Math.cos(t) * r, Math.sin(t) * r) < d) r += 0.01;
      heights.push(b.heightAt(Math.cos(t) * r, Math.sin(t) * r));
    }
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(1.2);
    expect(Math.max(...heights)).toBeLessThanOrEqual(1.8 + 0.06); // 1,8 m + leichter Noise
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.1); // kein perfekter Kreis
  });

  it('Hang: mindestens 3 m breit, beginnt ~1 m nach der Umrandung', () => {
    for (const pts of Object.values(regions)) {
      const b = createBasin({ pts });
      for (let a = 0; a < 32; a++) {
        const t = (a / 32) * Math.PI * 2;
        expect(b.wallWidth(t)).toBeGreaterThanOrEqual(3);
        expect(b.rimStart(t)).toBeGreaterThanOrEqual(0.85 - 1e-9);
        expect(b.rimStart(t)).toBeLessThanOrEqual(1.15 + 1e-9);
      }
    }
  });

  for (const [name, pts] of Object.entries(regions)) {
    it(`${name}: Steigung überall ≤ 25° (inkl. Noise und Querneigung)`, () => {
      const b = createBasin({ pts });
      const rnd = lcg(5);
      const e = 0.02;
      let maxDeg = 0;
      for (let i = 0; i < 20000; i++) {
        const t = rnd() * Math.PI * 2;
        const r = b.extent + rnd() * 22;
        const x = b.center.x + Math.cos(t) * r;
        const z = b.center.z + Math.sin(t) * r;
        const gx = (b.heightAt(x + e, z) - b.heightAt(x - e, z)) / (2 * e);
        const gz = (b.heightAt(x, z + e) - b.heightAt(x, z - e)) / (2 * e);
        maxDeg = Math.max(maxDeg, (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI);
      }
      expect(maxDeg).toBeLessThanOrEqual(25);
    });
  }

  it('Brett aus der Boundary-Anpassung liegt komplett im flachen Bereich', () => {
    const pts = regions.lForm;
    const fit = fitBoard(pts);
    const b = createBasin({ pts });
    const h = fit.side / 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const c = Math.cos(fit.yaw);
      const s = Math.sin(fit.yaw);
      const lx = sx * h;
      const lz = sz * h;
      expect(b.heightAt(fit.center.x + lx * c + lz * s, fit.center.z - lx * s + lz * c)).toBe(0);
    }
  });
});
