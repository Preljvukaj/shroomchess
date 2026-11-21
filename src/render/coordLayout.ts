import { FILES } from '../core/types';

/**
 * Reine Layout-Berechnung für die Koordinaten-Glyphen am Brettrand (testbar ohne WebGL).
 *
 * Brett-Konvention: Weiß steht bei +Z und blickt nach −Z, Schwarz umgekehrt.
 * Eine Glyphe ist ein Text in der lokalen XY-Ebene (oben = +Y, Vorderseite = +Z).
 * Sie wird mit Euler-Reihenfolge 'YXZ' gedreht:
 *   yaw   – um Y: 0 für Weiß, π für Schwarz (Text zeigt zum jeweiligen Leser),
 *   pitch – um X: −(90° − tilt). Bei tilt = 0 liegt der Text flach, die Oberkante zeigt
 *           vom Leser weg. tilt > 0 neigt ihn zum Leser hin auf.
 *
 * Jeder Spieler liest die Koordinaten auf SEINER Seite: Linien (a–h) an der eigenen
 * Grundreihe, Reihen (1–8) an seiner linken Brettkante.
 */
export interface CoordLabel {
  text: string;
  kind: 'file' | 'rank';
  /** 0..7 (a..h bzw. 1..8) */
  index: number;
  reader: 'w' | 'b';
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

export const COORD_TILT_DEG = 25;

/** Zeichenhöhe relativ zur Feldbreite (Vorgabe: mindestens 35–40 %). */
export const COORD_SIZE_FACTOR = { S: 0.38, M: 0.46, L: 0.55 } as const;

/** Breite des Moos-/Steinrings relativ zur Feldbreite (muss die größte Glyphe samt Plättchen fassen). */
export const FRAME_WIDTH_FACTOR = 0.8;

export function coordinateLayout(squareSize: number, tiltDeg = COORD_TILT_DEG): CoordLabel[] {
  const s = squareSize;
  const off = 4 * s + (FRAME_WIDTH_FACTOR * s) / 2 + s * 0.02; // Mitte des Rings
  const pitch = -((90 - tiltDeg) * Math.PI) / 180;
  const out: CoordLabel[] = [];
  for (let i = 0; i < 8; i++) {
    const c = (i - 3.5) * s;
    // Linien: Weiß an +Z, Schwarz an −Z
    out.push({ text: FILES[i], kind: 'file', index: i, reader: 'w', x: c, z: off, yaw: 0, pitch });
    out.push({ text: FILES[i], kind: 'file', index: i, reader: 'b', x: c, z: -off, yaw: Math.PI, pitch });
    // Reihen: Weiß links (−X), Schwarz links aus seiner Sicht (+X). Reihe i+1 liegt bei z = (3,5 − i)·s
    out.push({ text: String(i + 1), kind: 'rank', index: i, reader: 'w', x: -off, z: (3.5 - i) * s, yaw: 0, pitch });
    out.push({ text: String(i + 1), kind: 'rank', index: i, reader: 'b', x: off, z: (3.5 - i) * s, yaw: Math.PI, pitch });
  }
  return out;
}

/**
 * Kleine Feldbeschriftung wie bei Lichess (optional): Linienbuchstabe unten rechts auf der
 * ersten Reihe, Reihenzahl oben links auf der a-Linie – jeweils aus Sicht von `reader`.
 */
export function squareLabelLayout(squareSize: number, reader: 'w' | 'b'): CoordLabel[] {
  const s = squareSize;
  const out: CoordLabel[] = [];
  const inset = s * 0.36;
  const flip = reader === 'w' ? 1 : -1;
  const yaw = reader === 'w' ? 0 : Math.PI;
  const pitch = -Math.PI / 2;
  const baseRank = reader === 'w' ? 0 : 7;
  const baseFile = reader === 'w' ? 0 : 7;
  for (let i = 0; i < 8; i++) {
    const fx = (i - 3.5) * s;
    const fz = (3.5 - baseRank) * s;
    out.push({ text: FILES[i], kind: 'file', index: i, reader, x: fx + flip * inset, z: fz + flip * inset, yaw, pitch });
    const rx = (baseFile - 3.5) * s;
    const rz = (3.5 - i) * s;
    out.push({ text: String(i + 1), kind: 'rank', index: i, reader, x: rx - flip * inset, z: rz - flip * inset, yaw, pitch });
  }
  return out;
}
