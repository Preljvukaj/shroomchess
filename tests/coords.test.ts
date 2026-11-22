import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COORD_SIZE_FACTOR, FRAME_WIDTH_FACTOR, coordinateLayout, squareLabelLayout } from '../src/render/coordLayout';

const S = 0.5;
const readerPos = { w: new THREE.Vector3(0, 1.6, 4 * S + 1.5), b: new THREE.Vector3(0, 1.6, -(4 * S + 1.5)) };

function frame(l: { yaw: number; pitch: number }) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(l.pitch, l.yaw, 0, 'YXZ'));
  return {
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(q), // Oberkante des Texts
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(q), // Leserichtung
    normal: new THREE.Vector3(0, 0, 1).applyQuaternion(q), // Vorderseite
  };
}

/** Für einen Betrachter richtig herum: Oberkante zeigt (horizontal) von ihm weg, Leserichtung nach rechts. */
function readableFor(l: { yaw: number; pitch: number; x: number; z: number }, reader: 'w' | 'b'): boolean {
  const { up, right } = frame(l);
  const away = reader === 'w' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
  const rightOfReader = reader === 'w' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
  return up.dot(away) > 0.99 && right.dot(rightOfReader) > 0.99;
}

describe('Brett-Beschriftung im Rahmen', () => {
  it('liegt vollständig flach (Normale zeigt nach oben)', () => {
    for (const orient of ['both', 'w', 'b'] as const) {
      for (const l of coordinateLayout(S, orient)) expect(frame(l).normal.y).toBeGreaterThan(0.9999);
    }
  });

  it('32 Glyphen: a–h unten und oben, 1–8 links und rechts, mittig vor Feld bzw. Reihe', () => {
    const labels = coordinateLayout(S);
    expect(labels).toHaveLength(32);
    const off = 4 * S + (FRAME_WIDTH_FACTOR * S) / 2;
    for (const l of labels) {
      if (l.kind === 'file') {
        expect(Math.abs(l.z)).toBeCloseTo(off);
        expect(l.x).toBeCloseTo((l.index - 3.5) * S);
      } else {
        expect(Math.abs(l.x)).toBeCloseTo(off);
        expect(l.z).toBeCloseTo((3.5 - l.index) * S);
      }
      // im Rahmen, nicht auf den Feldern
      expect(Math.max(Math.abs(l.x), Math.abs(l.z))).toBeGreaterThan(4 * S);
      expect(Math.max(Math.abs(l.x), Math.abs(l.z))).toBeLessThan(4 * S + FRAME_WIDTH_FACTOR * S);
    }
  });

  it("'both': jede Rahmenseite für den Spieler dort lesbar, seitliche Zahlen zur näheren Grundreihe", () => {
    for (const l of coordinateLayout(S, 'both')) {
      if (l.kind === 'file') {
        const reader = l.z > 0 ? 'w' : 'b'; // untere Kante Weiß, obere Schwarz
        expect(l.reader).toBe(reader);
        expect(readableFor(l, reader), `${l.text}@${reader}`).toBe(true);
      } else {
        const reader = l.index < 4 ? 'w' : 'b'; // 1–4 näher an Weiß, 5–8 näher an Schwarz
        expect(l.reader).toBe(reader);
        expect(readableFor(l, reader), `${l.text}`).toBe(true);
      }
    }
  });

  it('Einzelspieler/online: alles für die gewählte Farbe lesbar', () => {
    for (const c of ['w', 'b'] as const) for (const l of coordinateLayout(S, c)) expect(readableFor(l, c)).toBe(true);
  });

  it('für Weiß von links nach rechts a→h; Reihen 1 nah → 8 fern', () => {
    const files = coordinateLayout(S, 'both').filter((l) => l.kind === 'file' && l.z > 0);
    expect(files.map((l) => l.text).join('')).toBe('abcdefgh');
    for (let i = 1; i < 8; i++) expect(files[i].x).toBeGreaterThan(files[i - 1].x);
    const ranks = coordinateLayout(S, 'both').filter((l) => l.kind === 'rank' && l.x < 0);
    for (let i = 1; i < 8; i++) expect(ranks[i].z).toBeLessThan(ranks[i - 1].z);
    void readerPos;
  });

  it('Rahmen 40–50 % der Feldbreite, Zeichen 50–60 % der Rahmenbreite (Standard M)', () => {
    expect(FRAME_WIDTH_FACTOR).toBeGreaterThanOrEqual(0.4);
    expect(FRAME_WIDTH_FACTOR).toBeLessThanOrEqual(0.5);
    expect(COORD_SIZE_FACTOR.M).toBeGreaterThanOrEqual(0.5);
    expect(COORD_SIZE_FACTOR.M).toBeLessThanOrEqual(0.6);
    expect(COORD_SIZE_FACTOR.L).toBeLessThan(1); // passt immer in den Rahmen
  });

  it('Feldbeschriftung liegt flach auf den Randfeldern', () => {
    for (const reader of ['w', 'b'] as const) {
      const l = squareLabelLayout(S, reader);
      expect(l).toHaveLength(16);
      for (const x of l) {
        expect(Math.max(Math.abs(x.x), Math.abs(x.z))).toBeLessThan(4 * S);
        expect(frame(x).normal.y).toBeGreaterThan(0.9999);
      }
    }
  });
});
