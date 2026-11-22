import { type V2, pointInPolygon, rotate } from './vec2';

/**
 * Platzierung der Info-Steintafel (Monolith) neben dem Brett.
 *
 * Die Tafel steht an einer Längsseite des Bretts (neben der a- oder h-Linie), mittig zwischen beiden Grundreihen,
 * damit beide Spieler sie sehen. Sie soll nicht im Laufweg stehen: bevorzugt direkt hinter der Boundary-Linie
 * (am äußeren Rand der Umrandung), aber nie weiter als `MAX_EXTRA` vom Rahmen entfernt (sonst unlesbar), und
 * immer mit `GAP` Abstand zum Rahmen (überlappt nie Brett oder Rahmen).
 *
 * Tafel-Querschnitt (Draufsicht, Tafel-lokal, +x = vom Brett weg): Dreieck mit Spitze zum Brett und zwei
 * Schauflächen – eine zur weißen (+z), eine zur schwarzen Grundreihe (−z).
 */

/** Maße bei Maßstab 1 (Meter). */
export const TABLET = {
  height: 1.38,
  /** Tiefe des Prismas (Spitze bis Rückseite) */
  depth: 0.56,
  /** Abstand Rahmenkante → Tafel-Spitze */
  gap: 0.35,
  /** höchstens so viel weiter weg als nötig (Lesbarkeit) */
  maxExtra: 1.4,
  /** Spielerstandort hinter der Grundreihe (für die Ausrichtung der Schauflächen) */
  standBehind: 0.6,
};

export interface TabletPose {
  /** Weltposition (Boden) */
  x: number;
  z: number;
  /** Yaw der Tafel-Gruppe (Tafel-lokal +x zeigt vom Brett weg) */
  yaw: number;
  /** +1: auf der +X-Seite des Bretts (rechts von Weiß, h-Linie), −1: −X-Seite (a-Linie) */
  side: 1 | -1;
  /** Maßstab (Tischmodus kleiner) */
  scale: number;
  /** Abstand Brettmitte → Tafel-Mitte (Brett-Einheiten = Meter in der Welt) */
  dist: number;
  /** halber Öffnungswinkel: Winkel der Schauflächen-Normalen gegen die Brett-Längsachse */
  faceAngle: number;
  /** steht (ganz oder teilweise) außerhalb der Boundary */
  outside: boolean;
}

/** Abstand vom Punkt `o` entlang `dir` bis zum Verlassen des Polygons (Marsch + Bisektion). */
export function exitDistance(region: V2[], o: V2, dir: V2, maxD = 30): number {
  if (!pointInPolygon(o, region)) return 0;
  let lo = 0;
  let hi = 0;
  for (let d = 0.05; d <= maxD; d += 0.05) {
    if (!pointInPolygon({ x: o.x + dir.x * d, z: o.z + dir.z * d }, region)) {
      hi = d;
      break;
    }
    lo = d;
  }
  if (hi === 0) return maxD;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    if (pointInPolygon({ x: o.x + dir.x * m, z: o.z + dir.z * m }, region)) lo = m;
    else hi = m;
  }
  return lo;
}

export function placeTablet(o: { center: V2; yaw: number; totalSide: number; region?: V2[]; scale?: number }): TabletPose {
  const scale = o.scale ?? 1;
  const half = o.totalSide / 2;
  const depth = TABLET.depth * scale;
  const minDist = half + TABLET.gap * scale + depth / 2;
  const standZ = half + TABLET.standBehind * scale;
  // nicht so weit seitlich, dass ein Spieler beide Schauflächen sähe (Winkel zum Spieler ≤ ~51°)
  const maxDist = Math.max(minDist, Math.min(minDist + TABLET.maxExtra * scale, standZ * 1.25));
  const sides: (1 | -1)[] = [1, -1];
  const options = sides.map((side) => {
    const dir = rotate({ x: side, z: 0 }, o.yaw);
    const exit = o.region && o.region.length >= 3 ? exitDistance(o.region, o.center, dir) : Infinity;
    // bevorzugt knapp hinter der Boundary-Linie; ohne Boundary (Desktop) etwas Luft zum Rahmen
    const want = Number.isFinite(exit) ? exit + depth / 2 + 0.05 * scale : minDist + 0.5 * scale;
    const dist = Math.min(Math.max(want, minDist), maxDist);
    return { side, dir, exit, dist };
  });
  // Seite mit der näheren Boundary: dort kostet die Tafel am wenigsten begehbare Fläche
  options.sort((a, b) => a.exit - b.exit || b.side - a.side);
  const best = options[0];
  // Richtung zum Spieler (gegen die Längsachse) ist α; die Fläche wird etwas flacher gestellt (β = 0,75 α, 12–35°),
  // damit jeder Spieler nur SEINE Fläche sieht (α + β < 90°), aber nahezu frontal (α − β klein).
  const alpha = Math.atan2(best.dist, standZ);
  const faceAngle = Math.min(35, Math.max(12, ((alpha * 0.75) * 180) / Math.PI)) * (Math.PI / 180);
  return {
    x: o.center.x + best.dir.x * best.dist,
    z: o.center.z + best.dir.z * best.dist,
    yaw: o.yaw + (best.side === 1 ? 0 : Math.PI),
    side: best.side,
    scale,
    dist: best.dist,
    faceAngle,
    outside: best.dist - depth / 2 >= best.exit - 1e-9,
  };
}

/**
 * Querschnitt der Tafel (Tafel-lokal, Draufsicht) für einen Öffnungswinkel: Spitze A (zum Brett),
 * B (+z, hinten), C (−z, hinten). Die Fläche A–B schaut zur +z-Seite, A–C zur −z-Seite.
 */
export function tabletSection(faceAngle: number, scale = 1): { a: V2; b: V2; c: V2 } {
  const d = TABLET.depth * scale;
  // Normale der Fläche A–B = (−sin α, cos α) ⇒ Kante A→B verläuft in Richtung (cos α, sin α)
  const len = d / Math.cos(faceAngle);
  const a = { x: -d / 2, z: 0 };
  const b = { x: -d / 2 + Math.cos(faceAngle) * len, z: Math.sin(faceAngle) * len };
  return { a, b, c: { x: b.x, z: -b.z } };
}

/** Normale (Welt) der Schaufläche, die zur Grundreihe von `color` zeigt. */
export function faceNormalWorld(p: TabletPose, color: 'w' | 'b'): V2 {
  // Tafel-lokal: Fläche A–B schaut nach +z. Bei side −1 ist die Gruppe um π gedreht → +z zeigt zu Schwarz.
  const localZ = (color === 'w') === (p.side === 1) ? 1 : -1;
  return rotate({ x: -Math.sin(p.faceAngle), z: localZ * Math.cos(p.faceAngle) }, p.yaw);
}

/** Welche lokale Fläche (+z oder −z) gehört zu welcher Farbe. */
export function faceFor(p: TabletPose, color: 'w' | 'b'): 1 | -1 {
  return (color === 'w') === (p.side === 1) ? 1 : -1;
}
