import { describe, expect, it } from 'vitest';
import { AsteroidSky, MAX_ACTIVE, MIN_ELEV, positionOf } from '../src/render/world/asteroidSim';
import { SKY_BODIES } from '../src/render/world/sky';

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const bodies = Object.values(SKY_BODIES).map((b) => ({ dir: { x: b.dir.x, y: b.dir.y, z: b.dir.z }, r: b.r }));

describe('Asteroiden am Himmel', () => {
  it('2 Stunden Simulation: nie im unteren Himmel/über dem Brett, nie durch Monde oder Gasriese, ≤ 8 gleichzeitig', () => {
    const sky = new AsteroidSky(lcg(7), bodies);
    const seen = { asteroid: new Set<number>(), comet: new Set<number>(), meteor: new Set<number>() };
    let maxActive = 0;
    let minElev = Infinity;
    let minBody = Infinity;
    const dt = 0.1;
    for (let t = 0; t < 7200; t += dt) {
      sky.step(dt);
      let active = 0;
      for (const o of sky.objects) {
        const p = positionOf(o, sky.now);
        if (!p) continue;
        active++;
        seen[o.kind].add(o.id);
        minElev = Math.min(minElev, Math.asin(p.y) - o.size);
        for (const b of bodies) minBody = Math.min(minBody, Math.acos(Math.min(1, p.x * b.dir.x + p.y * b.dir.y + p.z * b.dir.z)) - b.r - o.size);
      }
      maxActive = Math.max(maxActive, active);
    }
    expect(minElev).toBeGreaterThanOrEqual(MIN_ELEV - 1e-6); // ≥ 25° → nie im zentralen Blickfeld auf das Brett
    expect(minBody).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(MAX_ACTIVE);
    // Häufigkeiten: groß alle 45–120 s (Gruppen zählen mehrfach), Kometen alle 3–6 min, Sternschnuppen alle 10–30 s
    const groups = 7200 / 82.5;
    expect(seen.asteroid.size).toBeGreaterThan(groups * 0.7);
    expect(seen.comet.size).toBeGreaterThan(7200 / 360 * 0.7);
    expect(seen.comet.size).toBeLessThan(7200 / 180 * 1.3);
    expect(seen.meteor.size).toBeGreaterThan(7200 / 30 * 0.8);
    expect(seen.meteor.size).toBeLessThan(7200 / 10 * 1.2);
  });

  it('Überflugdauer: große 30–90 s, Sternschnuppen unter 1 s', () => {
    const sky = new AsteroidSky(lcg(3), bodies);
    const all = new Map<number, { kind: string; duration: number }>();
    for (let t = 0; t < 3600; t += 0.5) {
      sky.step(0.5);
      for (const o of sky.objects) all.set(o.id, o);
    }
    for (const o of all.values()) {
      if (o.kind === 'meteor') expect(o.duration).toBeLessThan(1);
      if (o.kind === 'asteroid') {
        expect(o.duration).toBeGreaterThanOrEqual(28);
        expect(o.duration).toBeLessThanOrEqual(95);
      }
    }
  });
});
