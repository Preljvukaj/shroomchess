import { describe, expect, it } from 'vitest';
import { TABLET, faceNormalWorld, placeTablet, tabletSection } from '../src/xr/math/tablet';
import { placeBoard } from '../src/xr/math/placement';
import { type V2, pointInPolygon, rotate } from '../src/xr/math/vec2';

const rect = (w: number, d: number): V2[] => [
  { x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 },
];
const lShape: V2[] = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2.6 }, { x: 2.6, z: 2.6 }, { x: 2.6, z: 6 }, { x: 0, z: 6 }];

/** Eckpunkte des Tafel-Fußes (Prisma) in Welt. */
function footprint(p: ReturnType<typeof placeTablet>): V2[] {
  const s = tabletSection(p.faceAngle, p.scale);
  return [s.a, s.b, s.c].map((v) => {
    const r = rotate(v, p.yaw);
    return { x: p.x + r.x, z: p.z + r.z };
  });
}

describe('Info-Steintafel', () => {
  const cases: [string, V2[], V2][] = [
    ['4×3', rect(4, 3), { x: 0, z: 1 }],
    ['6×5', rect(6, 5), { x: 0, z: 0 }],
    ['L-Form', lShape, { x: 1, z: 1 }],
    ['3,2²', rect(3.2, 3.2), { x: 0, z: 0 }],
  ];
  for (const [name, region, player] of cases) {
    for (const color of ['w', 'b'] as const) {
      it(`${name}/${color}: überlappt weder Brett noch Rahmen, steht neben einer Längsseite`, () => {
        const b = placeBoard(region, { pos: player, yaw: 0 }, color);
        const t = placeTablet({ center: b.center, yaw: b.yaw, totalSide: b.totalSide, region, scale: b.mode === 'table' ? 0.3 : 1 });
        const half = b.totalSide / 2;
        for (const v of footprint(t)) {
          // in Brett-Koordinaten
          const l = rotate({ x: v.x - b.center.x, z: v.z - b.center.z }, -b.yaw);
          expect(Math.max(Math.abs(l.x), Math.abs(l.z))).toBeGreaterThan(half + 0.1 * t.scale);
        }
        // mittig zwischen den Grundreihen (lokal z ≈ 0) neben der a- oder h-Linie
        const c = rotate({ x: t.x - b.center.x, z: t.z - b.center.z }, -b.yaw);
        expect(Math.abs(c.z)).toBeLessThan(1e-6);
        expect(Math.abs(c.x)).toBeGreaterThan(half);
        // nie weiter als nötig weg
        expect(t.dist).toBeLessThanOrEqual(half + (TABLET.gap + TABLET.depth / 2 + TABLET.maxExtra) * t.scale + 1e-6);
        // Passt sie nicht in die Boundary, steht sie dahinter (Boundary-Warnung bleibt aktiv)
        if (b.mode === 'roomscale' && !pointInPolygon({ x: t.x, z: t.z }, region)) expect(t.outside).toBe(true);
      });

      it(`${name}/${color}: jede Schaufläche zeigt zu ihrem Spieler`, () => {
        const b = placeBoard(region, { pos: player, yaw: 0 }, color);
        const t = placeTablet({ center: b.center, yaw: b.yaw, totalSide: b.totalSide, region });
        for (const c of ['w', 'b'] as const) {
          // Standort hinter der Grundreihe von c
          const behind = rotate({ x: 0, z: (c === 'w' ? 1 : -1) * (b.totalSide / 2 + 0.6) }, b.yaw);
          const stand = { x: b.center.x + behind.x, z: b.center.z + behind.z };
          const to = { x: stand.x - t.x, z: stand.z - t.z };
          const l = Math.hypot(to.x, to.z);
          const n = faceNormalWorld(t, c);
          expect((n.x * to.x + n.z * to.z) / l).toBeGreaterThan(0.85);
          // die Fläche der anderen Farbe zeigt vom Spieler weg (er sieht seine Seite, nicht die gespiegelte)
          const o = faceNormalWorld(t, c === 'w' ? 'b' : 'w');
          expect(o.x * to.x + o.z * to.z).toBeLessThan(0);
        }
      });
    }
  }
});
