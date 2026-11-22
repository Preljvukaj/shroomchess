import { FRAME_WIDTH_FACTOR } from '../../render/coordLayout';
import { type BoardFit, type FitOptions, alignYaw, fitBoard, withSide } from './boardFit';
import { type V2, add, forward, scale, sub, wrapAngle } from './vec2';

/**
 * Wo und wie groß das Brett in VR steht (reine Mathematik, testbar).
 *
 *  Roomscale: größtes Quadrat in der Boundary (0,5 m Abstand), Drehung unter den vier
 *             gleichwertigen 90°-Lagen so gewählt, dass die eigene Grundreihe zum Spieler zeigt.
 *  Tisch:     Feld 6 cm, 45 cm vor dem Spieler auf Tischhöhe – automatisch, wenn die Fläche
 *             zu klein ist (Feld < 0,2 m), oder im Sitzmodus.
 *
 * Brett-Konvention: Weiß steht bei lokalem +Z. rotate((0,1), yaw) = Richtung zur weißen Grundreihe.
 */

export interface PlayerPose {
  pos: V2;
  /** Blickrichtung (Yaw, siehe vec2.ts) */
  yaw: number;
}

export interface BoardPlacement {
  center: V2;
  yaw: number;
  /** Höhe der Brettoberfläche über dem Boden (0 = auf dem Boden). */
  height: number;
  squareSize: number;
  mode: 'roomscale' | 'table';
  /** größte zulässige Kantenlänge inkl. Rahmen (für manuelles Verkleinern) */
  maxSide: number;
  /** aktuelle Kantenlänge inkl. Rahmen */
  totalSide: number;
  /** Grund für den Tischmodus (für den Hinweis an den Spieler) */
  reason: 'fits' | 'small-room' | 'seated';
}

export const TABLE_SQUARE = 0.06;
export const TABLE_DISTANCE = 0.45;
export const TABLE_HEIGHT_STANDING = 0.85;
export const TABLE_HEIGHT_SEATED = 0.62;

/** Yaw, bei dem die Grundreihe von `color` zum Punkt `toward` zeigt. */
export function yawFacing(center: V2, toward: V2, color: 'w' | 'b'): number {
  const d = sub(toward, center);
  const y = Math.atan2(d.x, d.z); // rotate((0,1), y) = normalisiertes d
  return wrapAngle(color === 'w' ? y : y + Math.PI);
}

export function placeBoard(
  region: V2[],
  player: PlayerPose,
  color: 'w' | 'b',
  opts: { seated?: boolean; manualSide?: number; fit?: FitOptions } = {},
): BoardPlacement {
  // Brett + Steinrahmen müssen mit dem Sicherheitsabstand in die Boundary passen
  const fitOpts: FitOptions = { frameFactor: FRAME_WIDTH_FACTOR, ...opts.fit };
  const fit: BoardFit = fitBoard(region, fitOpts);
  const sized = opts.manualSide !== undefined ? withSide(fit, opts.manualSide, fitOpts) : fit;
  if (opts.seated || sized.mode === 'table') {
    const center = add(player.pos, scale(forward(player.yaw), TABLE_DISTANCE));
    return {
      center,
      yaw: yawFacing(center, player.pos, color),
      height: opts.seated ? TABLE_HEIGHT_SEATED : TABLE_HEIGHT_STANDING,
      squareSize: TABLE_SQUARE,
      mode: 'table',
      maxSide: fit.maxSide,
      totalSide: TABLE_SQUARE * (8 + 2 * FRAME_WIDTH_FACTOR),
      reason: opts.seated ? 'seated' : 'small-room',
    };
  }
  return {
    center: sized.center,
    yaw: alignYaw(sized.yaw, yawFacing(sized.center, player.pos, color)),
    height: 0,
    squareSize: sized.squareSize,
    mode: 'roomscale',
    maxSide: fit.maxSide,
    totalSide: sized.totalSide,
    reason: 'fits',
  };
}

/** Manuell getippte Ecken in eine gültige (nicht überschlagene) Polygon-Reihenfolge bringen. */
export function orderPolygon(pts: V2[]): V2[] {
  const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, z: a.z + p.z / pts.length }), { x: 0, z: 0 });
  return [...pts].sort((a, b) => Math.atan2(a.z - c.z, a.x - c.x) - Math.atan2(b.z - c.z, b.x - c.x));
}

/** Fläche eines Polygons (Betrag). */
export function polygonArea(pts: V2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return Math.abs(a) / 2;
}

/**
 * Zeigt die Handfläche zum Kopf? (Handgelenk-Menü bei Blick auf die Hand)
 * Normale = (Zeigefinger-Mittelhand − Handgelenk) × (Kleinfinger-Mittelhand − Handgelenk);
 * für die linke Hand zeigt sie aus der Handfläche heraus, für die rechte Hand umgekehrt.
 */
export function palmFacesHead(
  wrist: { x: number; y: number; z: number },
  indexMeta: { x: number; y: number; z: number },
  pinkyMeta: { x: number; y: number; z: number },
  head: { x: number; y: number; z: number },
  handedness: 'left' | 'right',
  threshold = 0.6,
): boolean {
  const a = { x: indexMeta.x - wrist.x, y: indexMeta.y - wrist.y, z: indexMeta.z - wrist.z };
  const b = { x: pinkyMeta.x - wrist.x, y: pinkyMeta.y - wrist.y, z: pinkyMeta.z - wrist.z };
  let n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  if (handedness === 'right') n = { x: -n.x, y: -n.y, z: -n.z };
  const ln = Math.hypot(n.x, n.y, n.z);
  const h = { x: head.x - wrist.x, y: head.y - wrist.y, z: head.z - wrist.z };
  const lh = Math.hypot(h.x, h.y, h.z);
  if (ln < 1e-9 || lh < 1e-9) return false;
  return (n.x * h.x + n.y * h.y + n.z * h.z) / (ln * lh) > threshold;
}
