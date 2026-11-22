import { describe, expect, it } from 'vitest';
import { TABLE_SQUARE, orderPolygon, palmFacesHead, placeBoard, polygonArea, yawFacing } from '../src/xr/math/placement';
import { maxHalfSideAt } from '../src/xr/math/boardFit';
import { type V2, dist, forward, rotate, wrapAngle } from '../src/xr/math/vec2';

const rect = (w: number, d: number): V2[] => [
  { x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 },
];

/** Richtung zur Grundreihe einer Farbe in Weltkoordinaten. */
const towardRank = (yaw: number, color: 'w' | 'b') => rotate({ x: 0, z: color === 'w' ? 1 : -1 }, yaw);

describe('VR-Brettplatzierung', () => {
  it('Roomscale: eigene Grundreihe zeigt zum Spieler (Weiß und Schwarz)', () => {
    const region = rect(5, 5);
    for (const [px, pz] of [[0, 2], [2, 0], [0, -2], [-1.8, 1.2]]) {
      for (const color of ['w', 'b'] as const) {
        const p = placeBoard(region, { pos: { x: px, z: pz }, yaw: 0 }, color);
        expect(p.mode).toBe('roomscale');
        const toPlayer = { x: px - p.center.x, z: pz - p.center.z };
        const l = Math.hypot(toPlayer.x, toPlayer.z);
        const t = towardRank(p.yaw, color);
        // innerhalb ±45° (das Quadrat erlaubt nur 90°-Schritte)
        expect((t.x * toPlayer.x + t.z * toPlayer.z) / l).toBeGreaterThan(Math.cos(Math.PI / 4) - 1e-6);
      }
    }
  });

  it('Roomscale: Größe und Lage aus der Boundary (Brett + Rahmen)', () => {
    const p = placeBoard(rect(4, 3), { pos: { x: 0, z: 1 }, yaw: 0 }, 'w');
    expect(p.squareSize).toBeCloseTo(2 / (8 + 2 * 0.45), 2); // 2 m Kante inkl. Rahmen
    expect(p.height).toBe(0);
  });

  it('Brett plus Rahmen passen mit 0,5 m Sicherheitsabstand in die Boundary', () => {
    const lShape = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2.6 }, { x: 2.6, z: 2.6 }, { x: 2.6, z: 6 }, { x: 0, z: 6 }];
    for (const region of [rect(4, 3), rect(6, 5), lShape, rect(3.2, 3.2)]) {
      const p = placeBoard(region, { pos: { x: 1, z: 1 }, yaw: 0 }, 'w');
      if (p.mode !== 'roomscale') continue;
      const total = p.squareSize * (8 + 2 * 0.45);
      expect(total).toBeCloseTo(p.totalSide, 6);
      // Quadrat inkl. Rahmen bei p.center/p.yaw passt mit Abstand 0,5 m
      expect(maxHalfSideAt(region, p.center, p.yaw, 0.5)).toBeGreaterThanOrEqual(total / 2 - 1e-3);
    }
  });

  it('Kleiner Raum → Tischmodus 45 cm vor dem Spieler, Weiß zum Spieler', () => {
    const player = { pos: { x: 0.2, z: 0.3 }, yaw: 0.7 };
    const p = placeBoard(rect(1.8, 1.8), player, 'w');
    expect(p.mode).toBe('table');
    expect(p.reason).toBe('small-room');
    expect(p.squareSize).toBe(TABLE_SQUARE);
    expect(dist(p.center, player.pos)).toBeCloseTo(0.45, 6);
    // Brett liegt in Blickrichtung
    const f = forward(player.yaw);
    expect((p.center.x - player.pos.x) * f.x + (p.center.z - player.pos.z) * f.z).toBeGreaterThan(0.44);
    const t = towardRank(p.yaw, 'w');
    expect(t.x * -f.x + t.z * -f.z).toBeCloseTo(1, 6);
    expect(p.height).toBeGreaterThan(0.5);
  });

  it('Sitzmodus erzwingt Tischgröße auch in großen Räumen, niedriger', () => {
    const p = placeBoard(rect(6, 6), { pos: { x: 0, z: 0 }, yaw: 0 }, 'b', { seated: true });
    expect(p.mode).toBe('table');
    expect(p.reason).toBe('seated');
    expect(p.height).toBeLessThan(0.7);
  });

  it('Manuelle Größe: nie größer als die Boundary erlaubt', () => {
    const p = placeBoard(rect(6, 6), { pos: { x: 0, z: 2 }, yaw: 0 }, 'w', { manualSide: 99 });
    expect(p.totalSide).toBeLessThanOrEqual(p.maxSide + 1e-9);
    const q = placeBoard(rect(6, 6), { pos: { x: 0, z: 2 }, yaw: 0 }, 'w', { manualSide: 2.67 });
    expect(q.squareSize).toBeCloseTo(0.3, 2);
  });

  it('yawFacing', () => {
    expect(wrapAngle(yawFacing({ x: 0, z: 0 }, { x: 0, z: 5 }, 'w'))).toBeCloseTo(0);
    expect(Math.abs(wrapAngle(yawFacing({ x: 0, z: 0 }, { x: 0, z: 5 }, 'b')))).toBeCloseTo(Math.PI);
  });
});

describe('Manuelle Flächeneinrichtung', () => {
  it('beliebig getippte Ecken ergeben ein gültiges Polygon', () => {
    const corners = rect(3, 2.5);
    const shuffled = [corners[2], corners[0], corners[3], corners[1]];
    const poly = orderPolygon(shuffled);
    expect(polygonArea(poly)).toBeCloseTo(7.5, 6); // überschlagen wäre kleiner
    const p = placeBoard(poly, { pos: { x: 0, z: 1 }, yaw: 0 }, 'w');
    expect(p.maxSide).toBeCloseTo(1.5, 2); // Quadrat inkl. Rahmen
  });
});

describe('Handgelenk-Menü: Handfläche zum Kopf', () => {
  // Linke Hand vor dem Gesicht, Handfläche zum Betrachter (+Z), Finger nach oben:
  // Daumen/Zeigefinger rechts (+X), kleiner Finger links (−X).
  const head = { x: 0, y: 1.6, z: 0.4 };
  const wrist = { x: 0, y: 1.3, z: 0 };
  const idx = { x: 0.03, y: 1.38, z: 0 };
  const pinky = { x: -0.03, y: 1.37, z: 0 };
  it('linke Hand, Handfläche zum Gesicht → ja', () => {
    expect(palmFacesHead(wrist, idx, pinky, head, 'left')).toBe(true);
  });
  it('linke Hand, Handrücken zum Gesicht → nein', () => {
    // Hand um 180° um die Hochachse gedreht: Zeigefinger links, kleiner Finger rechts
    expect(palmFacesHead(wrist, { ...idx, x: -0.03 }, { ...pinky, x: 0.03 }, head, 'left')).toBe(false);
  });
  it('rechte Hand gespiegelt → ja', () => {
    // rechte Hand, Handfläche zum Gesicht: Daumen/Zeigefinger links (−X)
    expect(palmFacesHead(wrist, { ...idx, x: -0.03 }, { ...pinky, x: 0.03 }, head, 'right')).toBe(true);
  });
});
