import { describe, expect, it } from 'vitest';
import { BED_SAMPLE_RATE, RECIPES, chorusIntensity, generateBedLoop, nextInterval, recipesFor } from '../src/audio/insectSounds';

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

  it('mindestens 12–15 verschiedene Einzelgeräusche, beide Kategorien', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(12);
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
