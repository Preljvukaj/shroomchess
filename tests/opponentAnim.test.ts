import { describe, expect, it } from 'vitest';
import { opponentTimeline } from '../src/render/opponentAnim';

const order = (steps: { kind: string; actor: string }[]) => steps.map((s) => `${s.actor}:${s.kind}`);

describe('Gegner-Animation', () => {
  it('normaler Zug „Langsam“: Vorwarnung → Anheben → Gleiten → Aufsetzen, 1,8–2,4 s', () => {
    for (const [from, to] of [['e7', 'e6'], ['e7', 'e5'], ['a8', 'h1'], ['g8', 'f6']]) {
      const { steps, total } = opponentTimeline({ from, to }, 'slow');
      expect(order(steps)).toEqual(['mover:glow', 'mover:lift', 'mover:glide', 'mover:land']);
      expect(total).toBeGreaterThanOrEqual(1.8);
      expect(total).toBeLessThanOrEqual(2.4);
      const g = steps.find((s) => s.kind === 'glow')!;
      expect(g.dur).toBeGreaterThanOrEqual(0.3);
      expect(g.dur).toBeLessThanOrEqual(0.5);
      const glide = steps.find((s) => s.kind === 'glide')!;
      expect(glide.dur).toBeGreaterThanOrEqual(0.8);
      expect(glide.dur).toBeLessThanOrEqual(1.2);
      // lückenlos hintereinander
      for (let i = 1; i < steps.length; i++) expect(steps[i].start).toBeCloseTo(steps[i - 1].start + steps[i - 1].dur, 9);
    }
  });

  it('weitere Strecken gleiten länger', () => {
    const near = opponentTimeline({ from: 'e7', to: 'e6' }, 'slow').total;
    const far = opponentTimeline({ from: 'a8', to: 'h1' }, 'slow').total;
    expect(far).toBeGreaterThan(near);
  });

  it('Schlagzug: Opfer löst sich erst auf, wenn der Angreifer über ihm ist (Beginn des Aufsetzens)', () => {
    const { steps } = opponentTimeline({ from: 'd5', to: 'e4', captured: 'p', capturedSquare: 'e4' }, 'slow');
    const land = steps.find((s) => s.kind === 'land' && s.actor === 'mover')!;
    const glide = steps.find((s) => s.kind === 'glide' && s.actor === 'mover')!;
    const dis = steps.find((s) => s.kind === 'dissolve')!;
    expect(dis.actor).toBe('victim');
    expect(dis.start).toBeCloseTo(land.start, 9);
    expect(dis.start).toBeGreaterThanOrEqual(glide.start + glide.dur - 1e-9);
    expect(dis.dur).toBeGreaterThan(0.6); // gemächlich
  });

  it('Rochade: erst der König vollständig, dann der Turm', () => {
    const { steps } = opponentTimeline({ from: 'e8', to: 'g8', rookMove: { from: 'h8', to: 'f8' } }, 'slow');
    expect(order(steps)).toEqual(['mover:glow', 'mover:lift', 'mover:glide', 'mover:land', 'rook:glow', 'rook:lift', 'rook:glide', 'rook:land']);
    const kingEnd = Math.max(...steps.filter((s) => s.actor === 'mover').map((s) => s.start + s.dur));
    const rookStart = Math.min(...steps.filter((s) => s.actor === 'rook').map((s) => s.start));
    expect(rookStart).toBeGreaterThanOrEqual(kingEnd - 1e-9);
  });

  it('En passant: Auflösen als eigener Schritt nach dem Aufsetzen', () => {
    const { steps } = opponentTimeline({ from: 'd4', to: 'e3', captured: 'p', capturedSquare: 'e4' }, 'slow');
    const land = steps.find((s) => s.kind === 'land')!;
    const dis = steps.find((s) => s.kind === 'dissolve')!;
    expect(dis.start).toBeCloseTo(land.start + land.dur, 9);
  });

  it('Umwandlung: eigener Schritt nach dem Aufsetzen (bei Schlag nach dem Auflösen-Start)', () => {
    const { steps } = opponentTimeline({ from: 'b2', to: 'a1', captured: 'r', capturedSquare: 'a1', promotion: 'q' }, 'slow');
    const land = steps.find((s) => s.kind === 'land')!;
    const pro = steps.find((s) => s.kind === 'promote')!;
    expect(pro.start).toBeGreaterThanOrEqual(land.start + land.dur - 1e-9);
  });

  it('Normal und Schnell sind kürzer', () => {
    const m = { from: 'e7', to: 'e5' };
    const s = opponentTimeline(m, 'slow').total;
    expect(opponentTimeline(m, 'normal').total).toBeCloseTo(s * 0.6, 6);
    expect(opponentTimeline(m, 'fast').total).toBeLessThan(0.8);
  });
});
