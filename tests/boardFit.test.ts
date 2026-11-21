import { describe, expect, it } from 'vitest';
import { alignYaw, fitBoard, maxHalfSideAt, withSide } from '../src/xr/math/boardFit';
import { type V2, rotate, wrapAngle } from '../src/xr/math/vec2';

const rect = (w: number, d: number, cx = 0, cz = 0): V2[] => [
  { x: cx - w / 2, z: cz - d / 2 },
  { x: cx + w / 2, z: cz - d / 2 },
  { x: cx + w / 2, z: cz + d / 2 },
  { x: cx - w / 2, z: cz + d / 2 },
];

describe('fitBoard', () => {
  it('Rechteck 4×3 m mit 0,5 m Abstand → Quadrat 2 m', () => {
    const f = fitBoard(rect(4, 3));
    expect(f.maxSide).toBeCloseTo(2, 2);
    expect(f.squareSize).toBeCloseTo(0.25, 2);
    expect(f.mode).toBe('roomscale');
    // Mittelpunkt in z exakt mittig; in x ist ein Streifen frei wählbar.
    expect(Math.abs(f.center.z)).toBeLessThan(0.01);
    expect(Math.abs(f.center.x)).toBeLessThanOrEqual(0.5 + 0.01);
  });

  it('großer Raum: automatische Größe ist auf 0,6 m Feldgröße gedeckelt', () => {
    const f = fitBoard(rect(8, 8));
    expect(f.maxSide).toBeCloseTo(7, 2);
    expect(f.squareSize).toBeCloseTo(0.6, 5);
  });

  it('kleiner Raum → Tischmodus', () => {
    const f = fitBoard(rect(2, 2)); // 1 m Kante → 0,125 m Feld
    expect(f.maxSide).toBeCloseTo(1, 2);
    expect(f.mode).toBe('table');
  });

  it('gedrehtes Rechteck: Ergebnis hängt nicht von der Lage ab', () => {
    const a = 0.4;
    const poly = rect(4, 3).map((p) => rotate(p, a)).map((p) => ({ x: p.x + 1.7, z: p.z - 0.9 }));
    const f = fitBoard(poly);
    expect(f.maxSide).toBeCloseTo(2, 2);
    // Brettkanten parallel zu den Raumwänden (modulo 90°)
    const diff = Math.abs(wrapAngle(4 * (f.yaw - a))) / 4;
    expect(diff).toBeLessThan(0.01);
  });

  it('L-förmige (nicht-konvexe) Boundary', () => {
    // 5×5 mit herausgeschnittenem 3×3-Quadrat oben rechts → Schenkel 2 m breit
    const L: V2[] = [
      { x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 },
    ];
    const f = fitBoard(L);
    // Im Eckbereich passt ein 2×2-Bereich plus Überhang; mit 0,5 m Abstand erwarten wir ≥ 1 m Kante.
    expect(f.maxSide).toBeGreaterThanOrEqual(1 - 1e-3);
    // Das Quadrat darf die Innenecke (2,2) nicht näher als 0,5 m berühren.
    const h = f.maxSide / 2;
    expect(maxHalfSideAt(L, f.center, f.yaw, 0.5)).toBeGreaterThanOrEqual(h - 1e-3);
  });

  it('Mittelpunkt außerhalb → 0', () => {
    expect(maxHalfSideAt(rect(4, 3), { x: 10, z: 0 }, 0, 0.5)).toBe(0);
  });

  it('manuelle Größe: verkleinern ja, vergrößern nie über die Boundary', () => {
    const f = fitBoard(rect(6, 6)); // maxSide 5
    expect(withSide(f, 3.2).squareSize).toBeCloseTo(0.4);
    expect(withSide(f, 50).side).toBeCloseTo(f.maxSide, 3);
    expect(withSide(f, 1.2).mode).toBe('table');
  });

  it('alignYaw wählt die nächste 90°-Variante', () => {
    expect(alignYaw(0.1, Math.PI / 2)).toBeCloseTo(0.1 + Math.PI / 2);
    expect(alignYaw(0.1, Math.PI)).toBeCloseTo(wrapAngle(0.1 + Math.PI));
  });
});
