import { describe, expect, it } from 'vitest';
import { grabConfig, pickGrabTarget, snapOffset, snapProgress } from '../src/render/grab';

describe('Greifen: Hysterese', () => {
  const A = { id: 'A' };
  const B = { id: 'B' };
  it('greifbar erst unter 10 cm, bleibt bis 14 cm, endet darüber', () => {
    let cur: typeof A | null = null;
    const step = (d: number) => (cur = pickGrabTarget([A], cur, () => d));
    expect(step(0.12)).toBeNull(); // Annäherung von außen: 12 cm reicht noch nicht
    expect(step(0.099)).toBe(A); // < 10 cm → greifbar
    expect(step(0.12)).toBe(A); // zwischen 10 und 14 cm: bleibt greifbar (kein Flackern)
    expect(step(0.139)).toBe(A);
    expect(step(0.141)).toBeNull(); // > 14 cm → aus
    expect(step(0.12)).toBeNull(); // und erst unter 10 cm wieder an
  });

  it('kein Flackern bei Zittern um die Schwelle', () => {
    let cur: typeof A | null = null;
    let changes = 0;
    let last: typeof A | null = null;
    for (let i = 0; i < 200; i++) {
      const d = 0.1 + Math.sin(i) * 0.015; // zittert ±1,5 cm um 10 cm
      cur = pickGrabTarget([A], cur, () => d);
      if (cur !== last) changes++;
      last = cur;
    }
    expect(changes).toBeLessThanOrEqual(1);
  });

  it('mehrere Figuren im Bereich: die nächste gewinnt, nur eine ist markiert', () => {
    const dist = { A: 0.09, B: 0.05 } as Record<string, number>;
    expect(pickGrabTarget([A, B], null, (x) => dist[x.id])).toBe(B);
    // aktuelle Figur bleibt, solange keine andere deutlich (> 2 cm) näher ist
    dist.A = 0.06;
    dist.B = 0.05;
    expect(pickGrabTarget([A, B], A, (x) => dist[x.id])).toBe(A);
    dist.B = 0.03;
    expect(pickGrabTarget([A, B], A, (x) => dist[x.id])).toBe(B);
  });

  it('Skalierung (Tischmodus) verkleinert die Zonen', () => {
    expect(pickGrabTarget([A], null, () => 0.05, 0.4)).toBeNull(); // 0,4 × 10 cm = 4 cm
    expect(pickGrabTarget([A], null, () => 0.03, 0.4)).toBe(A);
  });

  it('konfigurierbare Werte', () => {
    expect(grabConfig.enter).toBeCloseTo(0.1);
    expect(grabConfig.exit).toBeCloseTo(0.14);
    expect(pickGrabTarget([A], null, () => 0.15, 1, { ...grabConfig, enter: 0.2, exit: 0.25 })).toBe(A);
  });
});

describe('Greifen: Snap in die Hand', () => {
  it('ease-out in ~100 ms, danach exakt kein Versatz und kein Nachschwingen', () => {
    const start = { x: 0.06, y: -0.04, z: 0.02 };
    expect(snapOffset(start, 0)).toEqual(start);
    expect(snapProgress(0.05)).toBeGreaterThan(0.5); // ease-out: früh schon über die Hälfte
    const end = snapOffset(start, grabConfig.snapSeconds);
    expect(Math.abs(end.x) + Math.abs(end.y) + Math.abs(end.z)).toBe(0);
    let prev = Infinity;
    for (let t = 0; t <= 0.3; t += 0.005) {
      const o = snapOffset(start, t);
      const m = Math.hypot(o.x, o.y, o.z);
      expect(m).toBeLessThanOrEqual(prev + 1e-12); // monoton fallend → kein Überschwingen
      prev = m;
    }
    expect(grabConfig.snapSeconds).toBeGreaterThanOrEqual(0.08);
    expect(grabConfig.snapSeconds).toBeLessThanOrEqual(0.12);
  });
});

import { columnConfig, dropSquareAt, heldFootY, pickColumnTarget } from '../src/render/grab';
import { squareAt } from '../src/render/board';

describe('Greif-Säule', () => {
  const S = 0.5; // Feldbreite (m)
  const mk = (id: string, x: number, z: number) => ({ item: id, x, z, gripY: 1.1 });
  const pieces = [mk('e2', 0, 0), mk('d2', -S, 0), mk('e3', 0, -S)];

  it('Hand klar über der Figur ist greifbar – in jeder Höhe vom Griffpunkt bis 2,0 m', () => {
    for (const y of [1.1, 1.3, 1.6, 1.9, 1.99]) expect(pickColumnTarget(pieces, null, { x: 0.05, y, z: -0.03 }, S)).toBe('e2');
  });

  it('nicht über 2,0 m und nicht deutlich unter dem Griffpunkt', () => {
    expect(pickColumnTarget(pieces, null, { x: 0, y: 2.05, z: 0 }, S)).toBeNull();
    expect(pickColumnTarget(pieces, null, { x: 0, y: 0.9, z: 0 }, S)).toBeNull();
  });

  it('über dem Nachbarfeld bzw. zwischen den Feldern nicht', () => {
    expect(pickColumnTarget([mk('e2', 0, 0)], null, { x: -S, y: 1.5, z: 0 }, S)).toBeNull(); // über d2 (leer)
    expect(pickColumnTarget([mk('e2', 0, 0)], null, { x: S * 0.45, y: 1.5, z: 0 }, S)).toBeNull(); // Feldrand
    expect(pickColumnTarget(pieces, null, { x: -S * 0.95, y: 1.5, z: 0 }, S)).toBe('d2');
  });

  it('Säulen benachbarter Felder überschneiden sich nie (Radius < 50 %), auch mit Hysterese nicht', () => {
    expect(columnConfig.radiusFactor).toBeLessThan(0.5);
    expect(columnConfig.radiusFactor * columnConfig.exitFactor).toBeLessThan(0.5);
  });

  it('Hysterese: Eintritt beim Radius, Austritt erst bei +20 %', () => {
    const r = columnConfig.radiusFactor * S;
    let cur: string | null = null;
    const at = (x: number) => (cur = pickColumnTarget([mk('e2', 0, 0)], cur, { x, y: 1.5, z: 0 }, S));
    expect(at(r * 1.1)).toBeNull(); // von außen: 110 % reicht nicht
    expect(at(r * 0.95)).toBe('e2'); // Eintritt
    expect(at(r * 1.15)).toBe('e2'); // bis 120 % bleibt es
    expect(at(r * 1.25)).toBeNull(); // Austritt
  });

  it('mehrere möglich → kleinster horizontaler Abstand gewinnt', () => {
    const close = [mk('a', 0, 0), mk('b', 0.1, 0)]; // künstlich nah (nur für den Test)
    expect(pickColumnTarget(close, null, { x: 0.08, y: 1.5, z: 0 }, S)).toBe('b');
  });

  it('Ablegen zählt das Feld unter der Hand (horizontal), nicht die Höhe', () => {
    // Brett-lokal (Feld 0,5): e4 = Linie 4, Reihe 3 → x = 0,25, z = (3,5 − 3)·0,5 = +0,25
    const sq = (x: number, z: number) => squareAt(x, z, 0.5);
    for (const y of [0.0, 0.4, 1.0, 1.8, 2.5]) {
      expect(dropSquareAt({ x: 0.26, y, z: 0.27 }, sq)).toBe('e4');
      expect(dropSquareAt({ x: -0.26, y, z: 0.27 }, sq)).toBe('d4');
    }
  });

  it('Fuß der getragenen Figur nie unter der Brettoberfläche', () => {
    expect(heldFootY(0.3, 0.55)).toBe(0); // Hand in Hüfthöhe, Figur hoch → wird begrenzt
    expect(heldFootY(1.5, 0.55)).toBeCloseTo(0.95);
    for (let h = -1; h < 3; h += 0.1) expect(heldFootY(h, 1.1)).toBeGreaterThanOrEqual(0);
  });
});
