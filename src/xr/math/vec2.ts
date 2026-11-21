/**
 * 2D-Mathematik in der Bodenebene. Konvention wie in Three.js:
 * Boden = XZ-Ebene, Y zeigt nach oben, „vorwärts“ bei Yaw 0 ist −Z.
 * Yaw ist eine Drehung um +Y (gegen den Uhrzeigersinn von oben gesehen).
 */
export interface V2 {
  x: number;
  z: number;
}

export const v2 = (x: number, z: number): V2 => ({ x, z });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.z * b.z;
export const len = (a: V2): number => Math.hypot(a.x, a.z);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Dreht `p` um +Y mit Winkel `yaw` (identisch zu THREE.Object3D.rotation.y). */
export function rotate(p: V2, yaw: number): V2 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: p.x * c + p.z * s, z: -p.x * s + p.z * c };
}

/** Blickrichtung (Einheitsvektor) zu einem Yaw. */
export function forward(yaw: number): V2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Yaw zu einer (horizontalen) Blickrichtung. */
export function yawOf(dir: V2): number {
  return Math.atan2(-dir.x, -dir.z);
}

/** Winkel auf (−π, π] normieren. */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** Abstand Punkt–Strecke. */
export function pointSegmentDistance(p: V2, a: V2, b: V2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

/** Punkt-in-Polygon (Ray Casting, beliebige einfache Polygone). */
export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Kürzester Abstand eines Punktes zum Polygonrand. */
export function distanceToPolygonEdge(p: V2, poly: V2[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, pointSegmentDistance(p, poly[j], poly[i]));
  return d;
}
