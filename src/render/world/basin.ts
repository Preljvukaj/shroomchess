import { type V2, distanceToPolygonEdge, pointInPolygon } from '../../xr/math/vec2';

/**
 * Senke um die Spielfläche (reine Mathematik, ohne Three.js → testbar).
 *
 * SICHERHEIT: Innerhalb der Spielfläche (Boundary des Hosts bzw. Desktop-Fläche) und bis
 * mindestens 0,5 m darüber hinaus ist das Gelände exakt y = 0. Der Wall beginnt 0,5–1,0 m
 * außerhalb (unregelmäßig), steigt über 3–6 m sanft auf 2,5–4 m an und geht in ein Plateau über.
 */

export interface FlatRegion {
  /** Polygon der begehbaren Fläche (Boundary) in Weltkoordinaten (XZ). */
  pts: V2[];
}

export interface Basin {
  region: FlatRegion;
  center: V2;
  /** größter Abstand Mittelpunkt ↔ Polygonecke */
  extent: number;
  distOutside(x: number, z: number): number;
  rimStart(theta: number): number;
  wallWidth(theta: number): number;
  wallHeight(theta: number): number;
  heightAt(x: number, z: number): number;
  /** Abstand außerhalb der Fläche, ab dem der Wall oben ist (für Platzierung). */
  rimDistance(theta: number): number;
  thetaOf(x: number, z: number): number;
}

export const MIN_RIM_START = 0.5;
export const MAX_RIM_START = 1.0;

/** Deterministischer, periodischer Winkel-Rauschwert in [−1, 1]. */
function angularNoise(seed: number): (t: number) => number {
  let a = seed * 9301 + 49297;
  const rnd = () => ((a = (a * 9301 + 49297) % 233280) / 233280);
  const terms = [2, 3, 5, 7, 11].map((k) => ({ k, amp: 1 / Math.sqrt(k), ph: rnd() * Math.PI * 2 }));
  const norm = terms.reduce((s, x) => s + x.amp, 0);
  return (t) => terms.reduce((s, x) => s + x.amp * Math.sin(x.k * t + x.ph), 0) / norm;
}

const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

export function createBasin(region: FlatRegion, seed = 7): Basin {
  const pts = region.pts;
  const center = pts.reduce((c, p) => ({ x: c.x + p.x / pts.length, z: c.z + p.z / pts.length }), { x: 0, z: 0 });
  const extent = Math.max(...pts.map((p) => Math.hypot(p.x - center.x, p.z - center.z)));
  const nStart = angularNoise(seed);
  const nWidth = angularNoise(seed + 1);
  const nHeight = angularNoise(seed + 2);
  // Wallbreite wächst mit der Fläche: kleine Räume nicht abgeschnitten, große nicht zu eng
  const baseWidth = Math.min(6, Math.max(3, extent * 0.9));

  const distOutside = (x: number, z: number) => (pointInPolygon({ x, z }, pts) ? 0 : distanceToPolygonEdge({ x, z }, pts));
  const thetaOf = (x: number, z: number) => Math.atan2(z - center.z, x - center.x);
  const rimStart = (t: number) => MIN_RIM_START + (MAX_RIM_START - MIN_RIM_START) * (0.5 + 0.5 * nStart(t));
  const wallWidth = (t: number) => baseWidth * (0.85 + 0.3 * (0.5 + 0.5 * nWidth(t)));
  const wallHeight = (t: number) => Math.min(4, Math.max(2.5, 3.2 + 0.8 * nHeight(t)));

  const heightAt = (x: number, z: number) => {
    const d = distOutside(x, z);
    if (d <= MIN_RIM_START) return 0; // harte Garantie, unabhängig vom Rauschen
    const t = thetaOf(x, z);
    const u = (d - rimStart(t)) / wallWidth(t);
    if (u <= 0) return 0;
    const H = wallHeight(t);
    // feine Unebenheiten, nur am Hang (nie negativ, nie im flachen Bereich)
    const bump = (0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(z * 1.3) * 2)) * (0.5 + 0.5 * Math.sin(z * 2.1 + x * 0.4));
    const ramp = smoother(Math.min(1, u));
    const plateau = u > 1 ? Math.min(1, (u - 1) * 2) * 0.35 * Math.sin(t * 9 + d * 0.7) : 0;
    return H * ramp + bump * 0.3 * Math.min(1, u * 1.5) + plateau;
  };

  return {
    region,
    center,
    extent,
    distOutside,
    rimStart,
    wallWidth,
    wallHeight,
    heightAt,
    rimDistance: (t) => rimStart(t) + wallWidth(t),
    thetaOf,
  };
}

/** Quadratische Fläche um den Ursprung (Desktop: Brett + Rand). */
export function squarePolygon(half: number): V2[] {
  return [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ];
}

/** Abstand vom Mittelpunkt bis zum Polygonrand entlang eines Strahls (Bisektion). */
export function regionRadius(b: Basin, theta: number): number {
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  let lo = 0;
  let hi = b.extent * 1.01 + 0.01;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (pointInPolygon({ x: b.center.x + dx * m, z: b.center.z + dz * m }, b.region.pts)) lo = m;
    else hi = m;
  }
  return lo;
}

/**
 * Polares Geländegitter (Positionen + Indizes). Innerhalb der Fläche wenige Ringe
 * (alles y = 0), am Wall dicht, dahinter ein grobes Plateau, das in der Ferne endet.
 */
export function buildTerrainGrid(b: Basin, angular = 96, wallRings = 18, plateau = 14): { positions: Float32Array; index: Uint32Array; rings: number } {
  const ringsPerAngle: ((t: number, rb: number) => number)[] = [];
  ringsPerAngle.push(() => 0);
  ringsPerAngle.push((_t, rb) => rb * 0.5);
  ringsPerAngle.push((_t, rb) => rb);
  ringsPerAngle.push((t, rb) => rb + b.rimStart(t) * 0.5);
  ringsPerAngle.push((t, rb) => rb + b.rimStart(t));
  for (let j = 1; j <= wallRings; j++) ringsPerAngle.push((t, rb) => rb + b.rimStart(t) + b.wallWidth(t) * (j / wallRings));
  for (let j = 1; j <= 4; j++) ringsPerAngle.push((t, rb) => rb + b.rimStart(t) + b.wallWidth(t) + (plateau * j) / 4);
  const rings = ringsPerAngle.length;
  const positions = new Float32Array(angular * rings * 3);
  for (let a = 0; a < angular; a++) {
    const t = (a / angular) * Math.PI * 2;
    const rb = regionRadius(b, t);
    for (let r = 0; r < rings; r++) {
      const rr = ringsPerAngle[r](t, rb);
      const x = b.center.x + Math.cos(t) * rr;
      const z = b.center.z + Math.sin(t) * rr;
      const i = (a * rings + r) * 3;
      positions[i] = x;
      positions[i + 1] = b.heightAt(x, z);
      positions[i + 2] = z;
    }
  }
  const idx: number[] = [];
  for (let a = 0; a < angular; a++) {
    const a2 = (a + 1) % angular;
    for (let r = 0; r < rings - 1; r++) {
      const p = a * rings + r;
      const q = a2 * rings + r;
      idx.push(p, p + 1, q, q, p + 1, q + 1);
    }
  }
  return { positions, index: new Uint32Array(idx), rings };
}
