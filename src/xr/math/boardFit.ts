import { type V2, pointInPolygon, pointSegmentDistance, rotate, sub, wrapAngle } from './vec2';

/**
 * Brettgröße aus der Boundary berechnen: größtes Quadrat (beliebig gedreht), das
 * mit Sicherheitsabstand `margin` zu jeder Seite in das Boundary-Polygon passt.
 *
 * Verfahren: Für eine feste Lage (Mittelpunkt c, Drehung θ) wird das Polygon in das
 * Quadrat-Koordinatensystem transformiert. Dort ist das Quadrat achsparallel, und
 * der Abstand Strecke↔Quadrat lässt sich exakt berechnen (Schnitt → 0, sonst
 * Minimum aus Ecke↔Strecke und Endpunkt↔Quadrat). Die halbe Kantenlänge wird per
 * Bisektion maximiert. Über (c, θ) wird zuerst grob gerastert, dann lokal verfeinert.
 * Funktioniert auch für nicht-konvexe Boundaries (L-Form usw.).
 */

export interface BoardFit {
  center: V2;
  /** Drehung des Bretts um +Y (Bogenmaß, 0..π/2). */
  yaw: number;
  /** Größte zulässige Kantenlänge (Brett inkl. Rahmen). */
  maxSide: number;
  /** Kantenlänge der Spielfläche 8×8 (ohne Rahmen). */
  side: number;
  /** Kantenlänge inkl. Rahmen (= side bei frameFactor 0). */
  totalSide: number;
  squareSize: number;
  /** `table`, wenn die Feldgröße unter `minSquare` fällt. */
  mode: 'roomscale' | 'table';
}

export interface FitOptions {
  margin?: number; // Sicherheitsabstand, Standard 0,5 m
  minSquare?: number; // Untergrenze Feldgröße, Standard 0,2 m
  maxSquare?: number; // Obergrenze für die automatische Größe, Standard 0,6 m
  tableSquare?: number; // Feldgröße im Tischmodus, Standard 0,06 m
  /** Breite des Brett-Rahmens in Feldbreiten (je Seite). Brett + Rahmen müssen in die Boundary passen. */
  frameFactor?: number;
}

const DEFAULTS: Required<FitOptions> = { margin: 0.5, minSquare: 0.2, maxSquare: 0.6, tableSquare: 0.06, frameFactor: 0 };

/** Abstand Punkt ↔ achsparalleles Quadrat [−h,h]² (0, wenn innen). */
function pointBoxDistance(p: V2, h: number): number {
  const dx = Math.max(Math.abs(p.x) - h, 0);
  const dz = Math.max(Math.abs(p.z) - h, 0);
  return Math.hypot(dx, dz);
}

/** Schneidet die Strecke ab das Quadrat [−h,h]²? (Liang–Barsky) */
function segmentHitsBox(a: V2, b: V2, h: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x + h) && clip(dx, h - a.x) && clip(-dz, a.z + h) && clip(dz, h - a.z) && t0 <= t1;
}

function segmentBoxDistance(a: V2, b: V2, h: number): number {
  if (segmentHitsBox(a, b, h)) return 0;
  let d = Math.min(pointBoxDistance(a, h), pointBoxDistance(b, h));
  for (const c of [
    { x: h, z: h },
    { x: -h, z: h },
    { x: h, z: -h },
    { x: -h, z: -h },
  ])
    d = Math.min(d, pointSegmentDistance(c, a, b));
  return d;
}

/** Größte halbe Kantenlänge für ein Quadrat bei Mittelpunkt `c` und Drehung `yaw`. */
export function maxHalfSideAt(poly: V2[], c: V2, yaw: number, margin: number): number {
  if (!pointInPolygon(c, poly)) return 0;
  // Polygon ins Quadrat-System: um c verschieben, um −yaw drehen.
  const local = poly.map((p) => rotate(sub(p, c), -yaw));
  const fits = (h: number): boolean => {
    for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
      if (segmentBoxDistance(local[j], local[i], h) < margin) return false;
    }
    return true;
  };
  if (!fits(0)) return 0;
  let lo = 0;
  let hi = 1;
  while (fits(hi) && hi < 1000) {
    lo = hi;
    hi *= 2;
  }
  for (let k = 0; k < 32; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function fitBoard(poly: V2[], options: FitOptions = {}): BoardFit {
  const o = { ...DEFAULTS, ...options };
  if (poly.length < 3) throw new Error('Boundary braucht mindestens 3 Punkte');

  // Kandidaten-Drehungen: 5°-Raster plus die Richtungen langer Polygonkanten.
  const angles = new Set<number>();
  for (let d = 0; d < 90; d += 5) angles.add((d * Math.PI) / 180);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const e = sub(poly[i], poly[j]);
    if (Math.hypot(e.x, e.z) > 0.3) {
      let a = Math.atan2(e.z, e.x) % (Math.PI / 2);
      if (a < 0) a += Math.PI / 2;
      angles.add(Math.round(a * 1e4) / 1e4);
    }
  }

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }

  const N = 12;
  type Cand = { c: V2; yaw: number; h: number };
  const cands: Cand[] = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const c = { x: minX + ((maxX - minX) * i) / N, z: minZ + ((maxZ - minZ) * j) / N };
      if (!pointInPolygon(c, poly)) continue;
      for (const yaw of angles) cands.push({ c, yaw, h: maxHalfSideAt(poly, c, yaw, o.margin) });
    }
  }
  cands.sort((a, b) => b.h - a.h);

  // Lokale Verfeinerung (Pattern Search) für die besten Kandidaten.
  let best: Cand = cands[0] ?? { c: poly[0], yaw: 0, h: 0 };
  for (const start of cands.slice(0, 6)) {
    let cur = { ...start };
    let step = Math.max(maxX - minX, maxZ - minZ) / N;
    let aStep = (2.5 * Math.PI) / 180;
    while (step > 1e-3) {
      let improved = false;
      const tries: Cand[] = [
        { c: { x: cur.c.x + step, z: cur.c.z }, yaw: cur.yaw, h: 0 },
        { c: { x: cur.c.x - step, z: cur.c.z }, yaw: cur.yaw, h: 0 },
        { c: { x: cur.c.x, z: cur.c.z + step }, yaw: cur.yaw, h: 0 },
        { c: { x: cur.c.x, z: cur.c.z - step }, yaw: cur.yaw, h: 0 },
        { c: cur.c, yaw: cur.yaw + aStep, h: 0 },
        { c: cur.c, yaw: cur.yaw - aStep, h: 0 },
      ];
      for (const t of tries) {
        t.h = maxHalfSideAt(poly, t.c, t.yaw, o.margin);
        if (t.h > cur.h + 1e-6) {
          cur = t;
          improved = true;
        }
      }
      if (!improved) {
        step /= 2;
        aStep /= 2;
      }
    }
    if (cur.h > best.h) best = cur;
  }

  let yaw = wrapAngle(best.yaw) % (Math.PI / 2);
  if (yaw < 0) yaw += Math.PI / 2;
  const maxSide = 2 * best.h;
  return withSide({ center: best.c, yaw, maxSide }, Math.min(maxSide, (8 + 2 * o.frameFactor) * o.maxSquare), o);
}

/**
 * Manuelle Größenänderung: verkleinern ist immer erlaubt, vergrößern nie über
 * die Boundary hinaus. Unter der Untergrenze wird in den Tischmodus geschaltet.
 */
export function withSide(
  fit: Pick<BoardFit, 'center' | 'yaw' | 'maxSide'>,
  requestedSide: number,
  options: FitOptions = {},
): BoardFit {
  const o = { ...DEFAULTS, ...options };
  const n = 8 + 2 * o.frameFactor; // Felder über die Gesamtbreite (inkl. Rahmen)
  const total = Math.max(0, Math.min(requestedSide, fit.maxSide));
  if (total / n < o.minSquare) {
    return { ...fit, side: 8 * o.tableSquare, totalSide: n * o.tableSquare, squareSize: o.tableSquare, mode: 'table' };
  }
  return { ...fit, side: (total / n) * 8, totalSide: total, squareSize: total / n, mode: 'roomscale' };
}

/**
 * Das Quadrat ist 90°-symmetrisch. Wählt unter yaw + k·90° die Variante,
 * die einer Wunschrichtung (z. B. Blickrichtung des Hosts) am nächsten kommt.
 */
export function alignYaw(fittedYaw: number, desiredYaw: number): number {
  let best = fittedYaw;
  let bestErr = Infinity;
  for (let k = 0; k < 4; k++) {
    const y = wrapAngle(fittedYaw + (k * Math.PI) / 2);
    const err = Math.abs(wrapAngle(y - desiredYaw));
    if (err < bestErr) {
      bestErr = err;
      best = y;
    }
  }
  return best;
}
