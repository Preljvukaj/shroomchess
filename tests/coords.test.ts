import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { COORD_SIZE_FACTOR, COORD_TILT_DEG, FRAME_WIDTH_FACTOR, coordinateLayout, squareLabelLayout } from '../src/render/coordLayout';

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

describe('Koordinaten-Layout', () => {
  const labels = coordinateLayout(S);

  it('32 Glyphen: a–h und 1–8 je zweimal (eine pro Spielerseite)', () => {
    expect(labels).toHaveLength(32);
    for (const reader of ['w', 'b'] as const) {
      const mine = labels.filter((l) => l.reader === reader);
      expect(mine.filter((l) => l.kind === 'file').map((l) => l.text).sort().join('')).toBe('abcdefgh');
      expect(mine.filter((l) => l.kind === 'rank').map((l) => l.text).sort().join('')).toBe('12345678');
    }
  });

  it('jede Glyphe ist für ihren Spieler richtig herum (nicht auf dem Kopf, nicht gespiegelt)', () => {
    for (const l of labels) {
      const { up, right, normal } = frame(l);
      const eye = readerPos[l.reader];
      const pos = new THREE.Vector3(l.x, 0, l.z);
      const toLabel = pos.clone().sub(eye).setY(0).normalize();
      // Oberkante zeigt vom Leser weg (am Boden liegender Text wird „nach vorne“ gelesen)
      expect(up.clone().setY(0).normalize().dot(toLabel), `${l.reader}:${l.text}`).toBeGreaterThan(0.3);
      // Vorderseite ist dem Leser zugewandt
      expect(normal.dot(eye.clone().sub(pos).normalize()), `${l.reader}:${l.text}`).toBeGreaterThan(0);
      // Leserichtung = rechts aus Sicht des Spielers (Weiß: +X, Schwarz: −X)
      expect(Math.sign(right.x)).toBe(l.reader === 'w' ? 1 : -1);
    }
  });

  it('Neigung 20–30° zum Spieler hin', () => {
    for (const l of labels) {
      const { normal } = frame(l);
      const tilt = 90 - (Math.acos(THREE.MathUtils.clamp(normal.y, -1, 1)) * 180) / Math.PI;
      // Normale um (90 − tilt) aus der Senkrechten → Fläche ist um `tilt` aus dem Boden aufgerichtet
      expect(90 - tilt).toBeGreaterThanOrEqual(20);
      expect(90 - tilt).toBeLessThanOrEqual(30);
    }
    expect(COORD_TILT_DEG).toBeGreaterThanOrEqual(20);
  });

  it('Glyphen liegen auf dem Rahmen außerhalb der Felder, Reihenfolge stimmt', () => {
    const w = labels.filter((l) => l.reader === 'w' && l.kind === 'file');
    expect(w.map((l) => l.text).join('')).toBe('abcdefgh');
    for (let i = 1; i < 8; i++) expect(w[i].x).toBeGreaterThan(w[i - 1].x); // a links → h rechts für Weiß
    const wr = labels.filter((l) => l.reader === 'w' && l.kind === 'rank');
    for (let i = 1; i < 8; i++) expect(wr[i].z).toBeLessThan(wr[i - 1].z); // 1 nah → 8 fern
    for (const l of labels) expect(Math.max(Math.abs(l.x), Math.abs(l.z))).toBeGreaterThan(4 * S);
  });

  it('Mindestgröße 35 % der Feldbreite und passt in den Rahmen', () => {
    expect(COORD_SIZE_FACTOR.S).toBeGreaterThanOrEqual(0.35);
    // größte Glyphe samt Plättchen (×1,5) projiziert auf den Boden (cos 25°) passt in die Rahmenbreite
    expect(COORD_SIZE_FACTOR.L * 1.5 * Math.cos((COORD_TILT_DEG * Math.PI) / 180)).toBeLessThanOrEqual(FRAME_WIDTH_FACTOR + 0.5);
  });

  it('Feldbeschriftung liegt auf den Randfeldern der jeweiligen Seite', () => {
    for (const reader of ['w', 'b'] as const) {
      const l = squareLabelLayout(S, reader);
      expect(l).toHaveLength(16);
      for (const x of l) expect(Math.max(Math.abs(x.x), Math.abs(x.z))).toBeLessThan(4 * S);
    }
  });
});
