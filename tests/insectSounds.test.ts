import { describe, expect, it } from 'vitest';
import { BED_SAMPLE_RATE, INSECT_RECIPES, RECIPES, pickRecipe, recipeWeight, chorusIntensity, generateBedLoop, nextFlybyInterval, nextInterval, recipesFor } from '../src/audio/insectSounds';
import { chooseVoice, dopplerCents, flybyPath, pathMinDistance } from '../src/audio/mix';

describe('Insektenklänge', () => {
  it('Ambient-Bed: Hauptloop ≥ 60 s, Stereo, hörbar, nicht übersteuert', () => {
    const loop = generateBedLoop('crickets', 64, 3);
    expect(loop.left.length).toBe(64 * BED_SAMPLE_RATE);
    expect(loop.right.length).toBe(loop.left.length);
    let peak = 0, energy = 0, diffLR = 0;
    for (let i = 0; i < loop.left.length; i++) {
      peak = Math.max(peak, Math.abs(loop.left[i]), Math.abs(loop.right[i]));
      energy += loop.left[i] ** 2;
      diffLR += Math.abs(loop.left[i] - loop.right[i]);
    }
    expect(energy).toBeGreaterThan(0);
    expect(peak).toBeLessThan(0.6);
    expect(diffLR).toBeGreaterThan(0); // echtes Stereo, nicht mono dupliziert
  });

  it('Loops sind nahtlos (kein Sprung an der Schleifengrenze) und unterschiedlich lang', () => {
    for (const [kind, sec] of [['crickets', 64], ['hum', 23], ['trills', 37]] as const) {
      const l = generateBedLoop(kind, sec, 7);
      const n = l.left.length;
      // typischer Abstand benachbarter Samples als Maßstab
      let avg = 0;
      for (let i = 1; i < n; i++) avg += Math.abs(l.left[i] - l.left[i - 1]);
      avg /= n - 1;
      const seam = Math.abs(l.left[0] - l.left[n - 1]);
      expect(seam).toBeLessThanOrEqual(Math.max(avg * 8, 1e-4));
    }
  });

  it('mindestens 20 verschiedene Insektengeräusche + Pflanzen, Tropfen, Rufe', () => {
    expect(INSECT_RECIPES().length).toBeGreaterThanOrEqual(20);
    for (const c of ['plant', 'drip', 'call'] as const) expect(recipesFor(c).length).toBeGreaterThanOrEqual(1);
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    expect(recipesFor('flyby').length).toBeGreaterThanOrEqual(5);
    expect(recipesFor('ground').length).toBeGreaterThanOrEqual(5);
  });

  it('Intervalle 1,5–6 s, Intensität schwankt langsam über Minuten', () => {
    for (let i = 0; i <= 20; i++) for (const k of [0.3, 0.6, 1]) {
      const v = nextInterval(i / 20, k);
      expect(v).toBeGreaterThanOrEqual(1.5);
      expect(v).toBeLessThanOrEqual(6);
    }
    const vals = Array.from({ length: 1200 }, (_, s) => chorusIntensity(s));
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.3);
    // langsam: in 1 s ändert sich wenig
    for (let s = 1; s < 1200; s++) expect(Math.abs(vals[s] - vals[s - 1])).toBeLessThan(0.01);
  });
});

describe('Geräuschkulisse: Vorbeiflüge und Mix', () => {
  it('Vorbeiflug-Intervall 0,5–3 s', () => {
    for (let i = 0; i <= 20; i++) for (const k of [0.3, 0.6, 1]) {
      const v = nextFlybyInterval(i / 20, k);
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('Vorbeiflug-Bahn führt von einer Seite zur anderen am Kopf vorbei, nie näher als 0,8 m', () => {
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const head = { x: rnd() * 4 - 2, y: 1.5 + rnd() * 0.3, z: rnd() * 4 - 2 };
      const a = rnd() * Math.PI * 2;
      const fwd = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      const p = flybyPath(head, fwd, rnd);
      const min = pathMinDistance(p.start, p.end, head);
      expect(min).toBeGreaterThanOrEqual(0.8 - 1e-6);
      expect(min).toBeLessThanOrEqual(1.5);
      // Start und Ende auf verschiedenen Seiten (Rechts-Achse)
      const right = { x: -fwd.z, z: fwd.x };
      const sideS = (p.start.x - head.x) * right.x + (p.start.z - head.z) * right.z;
      const sideE = (p.end.x - head.x) * right.x + (p.end.z - head.z) * right.z;
      expect(Math.sign(sideS)).toBe(-Math.sign(sideE));
    }
  });

  it('Doppler: beim Nähern höher, beim Entfernen tiefer, nur leicht', () => {
    const head = { x: 0, y: 1.6, z: 0 };
    const c = dopplerCents({ x: -3.5, y: 1.6, z: 1 }, { x: 3.5, y: 1.6, z: 1 }, head, 1.6);
    expect(c[0]).toBeGreaterThan(0);
    expect(c[c.length - 1]).toBeLessThan(0);
    for (const v of c) expect(Math.abs(v)).toBeLessThan(400); // < ⅓ Oktave
  });

  it('Stimmen-Priorität: freie Stimme zuerst, sonst wird die fernste verdrängt – aber nur von einem näheren Klang', () => {
    const voices = Array.from({ length: 4 }, () => ({ busyUntil: 0, dist: 0 }));
    expect(chooseVoice(voices, 10, 2, 4)).toBe(0);
    voices.forEach((v, i) => ((v.busyUntil = 20), (v.dist = [3, 9, 5, 1][i])));
    expect(chooseVoice(voices, 10, 2, 4)).toBe(1); // fernste (9 m) wird verdrängt
    expect(chooseVoice(voices, 10, 12, 4)).toBe(-1); // neuer Klang ist ferner → verworfen
  });
});

describe('Blasen-Gluckern und weniger Rauschen', () => {
  it('mindestens 8 Gluckervarianten', () => {
    expect(recipesFor('glug').length).toBeGreaterThanOrEqual(8);
  });
  it('Mückensirren wird seltener gewählt', () => {
    const list = recipesFor('flyby');
    const m = list.find((r) => r.id === 'muecke')!;
    expect(recipeWeight(m)).toBeLessThan(0.5);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (pickRecipe(list, i / 2000).id === 'muecke') hits++;
    expect(hits / 2000).toBeLessThan(1 / list.length);
  });
  it('Summen-Teppich hat nur noch wenig Rauschanteil', () => {
    const l = generateBedLoop('hum', 23, 2);
    let rms = 0;
    for (let i = 0; i < l.left.length; i++) rms += l.left[i] ** 2;
    rms = Math.sqrt(rms / l.left.length);
    expect(rms).toBeLessThan(0.01);
  });
});
