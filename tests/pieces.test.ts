import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WIDE_THRESHOLD, pieceGeometry, pieceLathe } from '../src/render/pieces';
import type { PieceSymbol } from '../src/core/types';

const TYPES: PieceSymbol[] = ['p', 'r', 'n', 'b', 'q', 'k'];

/** Jede Kante muss genau zwei Dreiecke haben (geschlossene Hülle, keine Risse an den Nähten). */
function openEdges(g: THREE.BufferGeometry): number {
  const idx = g.index!.array;
  const edges = new Map<string, number>();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const n of edges.values()) if (n !== 2) bad++;
  return bad;
}

describe('Figuren: mehr Segmente an breiten Querschnitten', () => {
  for (const segments of [18, 26, 32, 36]) {
    for (const type of TYPES) {
      it(`${type} @ ${segments}: breite Ringe 1,5×, schmale unverändert, keine offenen Kanten`, () => {
        const { geo, profile, counts } = pieceLathe(type, segments);
        const rMax = Math.max(...profile.map(([r]) => r));
        profile.forEach(([r], k) => {
          if (r < 1e-6) expect(counts[k]).toBe(1);
          else if (r > WIDE_THRESHOLD * rMax) expect(counts[k]).toBe(Math.round(segments * 1.5));
          else expect(counts[k]).toBe(segments);
        });
        // Sockel ist breit, der Hals schmal
        expect(counts[1]).toBe(Math.round(segments * 1.5));
        expect(counts.some((c) => c === segments)).toBe(true);
        expect(openEdges(geo)).toBe(0);
        // Silhouette: jeder Profilpunkt liegt exakt auf seinem Ring
        const pos = geo.getAttribute('position');
        let start = 0;
        profile.forEach(([r, y], k) => {
          const v = new THREE.Vector3().fromBufferAttribute(pos, start);
          expect(Math.hypot(v.x, v.z)).toBeCloseTo(r, 6);
          expect(v.y).toBeCloseTo(y, 6);
          start += counts[k];
        });
      });
    }
  }

  it('Normalen zeigen nach außen (Sockelring)', () => {
    const { geo } = pieceLathe('k', 32);
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    // Ring 1 = äußerer Sockelrand
    const v = new THREE.Vector3().fromBufferAttribute(pos, 1);
    const n = new THREE.Vector3().fromBufferAttribute(nor, 1);
    expect(n.x * v.x + n.z * v.z).toBeGreaterThan(0);
  });

  it('Dreieckszahl aller 32 Figuren (vorher/nachher) bleibt im Budget', () => {
    const SET: Record<PieceSymbol, number> = { p: 16, r: 4, n: 4, b: 4, q: 2, k: 2 };
    const tris = (seg: number, f: number) => TYPES.reduce((s, t) => s + (pieceGeometry(t, seg, f).index!.count / 3) * SET[t], 0);
    const report: Record<string, [number, number]> = {};
    for (const [q, seg] of [['low', 18], ['medium', 26], ['high', 36]] as const) report[q] = [tris(seg, 1), tris(seg, 1.5)];
    console.log('Dreiecke 32 Figuren (vorher → nachher):', JSON.stringify(report));
    for (const [, [before, after]] of Object.entries(report)) {
      expect(after).toBeGreaterThan(before);
      expect(after).toBeLessThan(before * 1.5);
    }
    expect(report.low[1]).toBeLessThan(60_000);
  });
});
