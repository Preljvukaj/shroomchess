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
